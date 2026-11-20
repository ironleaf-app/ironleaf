// One task, one home, in the write mechanism (p12-task-writes, 4 Nov 2026). Every door that adds a next step runs
// planNextAdds first — the project's open steps and its connected notes' open tasks, exact after normalising, then the
// on-device meaning model at a strict threshold — and a match updates that task (date, owner, added detail) instead of
// adding another. The model off means exact only; below the threshold is a new task. A task for a person's page goes
// on the project with a plain pointer left behind, or to the Inbox when no project fits (routeNoteTask).

import type { VaultIndex } from './indexer';
import { INBOX_NOTE } from '../shared/inbox';
import { findAllTasks, isPersonNote, locateAnyTask, parseTaskLine, setTaskDue, setTaskRest, setTaskWho, splitTaskRest, taskEditableRest } from '../shared/tasks';
import { alreadyThereWords, normalizeTaskWhat, pickMeaningMatch, resolveWriteWhen } from '../shared/task-write';
import { namesPerson } from '../shared/project-hub';
import { parseProject, type ProjectEdit } from '../shared/project-file';

export interface NextItem {
  what: string;
  who?: string;
  when?: string;
  more?: string;
}

/** Short texts to the on-device model's vectors (null: the model is off — exact only). */
export type EmbedTexts = (texts: string[]) => Promise<number[][] | null>;

/** Meaning candidates past this stay exact-only (bounded: the exact pass already saw them all, and past the bar in
 *  the open is read as a new task, never a guess). */
const MEANING_CANDS = 60;
/** Texts embedded at once (the one embedding service's own cap: src/main/meaning-service.ts). */
const EMBED_BATCH = 20;

export interface PlannedAdd {
  kind: 'add';
  item: { what: string; who?: string; when?: string; more?: string };
}
export interface PlannedProjectUpdate {
  kind: 'update-project';
  index: number;
  /** The line as it was already there (what, owner and day as written). */
  line: string;
  patch: { who?: string; when?: string; more?: string };
  updated: boolean;
  /** A twin of a step planned earlier in this same call: merged into it (no edit of its own). */
  merged?: boolean;
}
export interface PlannedNoteUpdate {
  kind: 'update-note';
  path: string;
  line: number;
  text: string;
  patch: { who?: string; iso?: string; detail?: string; condition?: string; state?: 'ongoing' | 'open' };
  /** The line as it was already there. */
  display: string;
  updated: boolean;
}
export type Planned = PlannedAdd | PlannedProjectUpdate | PlannedNoteUpdate;

const clean = (v: unknown, max = 400): string => (typeof v === 'string' ? v : '').replace(/\s+/g, ' ').trim().slice(0, max);
const titleOf = (rel: string) => (rel.split('/').pop() ?? rel).replace(/\.md$/i, '');
const stepLine = (s: { what: string; who?: string; when?: string }) => `${s.what}${s.who ? ` — ${s.who}` : ''}${s.when ? ` · by ${s.when}` : ''}`;
const stateWord = (state: 'ongoing' | 'open') => (state === 'ongoing' ? 'Ongoing' : 'Open');

interface Cand {
  key: string;
  embedText: string;
  projIndex?: number;
  note?: { path: string; line: number; text: string; due: string | null };
  line: string;
  /** A step planned earlier in this same call (a twin merges into it, never a second line). */
  added?: PlannedAdd;
}

/** A note task's line with the update applied: the owner, the real date in the one plain way, added detail in
 *  brackets after the title (the owner tail untouched, so who it is on never shifts). */
export function updateNoteTaskLine(line: string, patch: { who?: string; iso?: string; detail?: string; condition?: string; state?: 'ongoing' | 'open' }, ref: Date = new Date()): string {
  let out = line;
  const parsed = parseTaskLine(line, ref);
  if (patch.iso && parsed && parsed.due !== patch.iso) out = setTaskDue(out, patch.iso);
  if (patch.who) {
    const next = setTaskWho(out, patch.who, ref);
    if (next !== out) out = next;
  }
  const extras = [patch.detail ? patch.detail.replace(/\s+/g, ' ').trim().slice(0, 160) : '', patch.condition ? patch.condition.replace(/\s+/g, ' ').trim().slice(0, 160) : '', patch.state ? stateWord(patch.state) : ''].filter(Boolean);
  for (const extra of extras) {
    if (!extra || out.includes(extra)) continue;
    const rest = taskEditableRest(out, ref);
    if (rest === null) continue;
    const { title, tail } = splitTaskRest(rest);
    if (!title) continue;
    out = setTaskRest(out, `${title} (${extra})${tail}`, ref);
  }
  return out;
}

interface Miss {
  what: string;
  who: string;
  whenStored?: string;
  iso?: string;
  state?: 'ongoing' | 'open';
  more?: string;
  condition?: string;
  /** Where its pending add sits in the plan (a meaning hit replaces it with the update). */
  at: number;
  pending: PlannedAdd;
}

/**
 * Each next step planned: added with its real date, or updating the task already there (the project's open steps
 * first, then its connected notes' open tasks, then the steps planned earlier in this call). `updates` is what the
 * model is told for each match ("already there: <line>; updated"); adds say nothing here — the caller counts them.
 */
export async function planNextAdds(
  index: VaultIndex,
  projectPath: string,
  items: NextItem[],
  opts: { embed?: EmbedTexts; now?: Date; skipProject?: boolean } = {},
): Promise<{ planned: Planned[]; updates: string[] }> {
  const now = opts.now ?? new Date();
  const p = parseProject(index.content(projectPath) ?? '', projectPath);
  const cands: Cand[] = [];
  // skipProject: a list that replaces the project's own (the side chat's save_project) — the check runs against the
  // connected notes and the twins in the list itself, never the lines being replaced.
  if (!opts.skipProject) {
    p.next.forEach((s, i) => {
      const key = normalizeTaskWhat(s.what);
      if (!s.done && key) cands.push({ key, embedText: s.what, projIndex: i, line: stepLine(s) });
    });
  }
  try {
    const owner = index.relations().owner;
    for (const [notePath, proj] of owner) {
      if (proj !== projectPath) continue;
      const content = index.content(notePath);
      if (content === undefined) continue;
      for (const t of findAllTasks(content, now)) {
        if (t.done || t.reminder) continue;
        const key = normalizeTaskWhat(t.words) || normalizeTaskWhat(t.text);
        if (!key) continue;
        cands.push({ key, embedText: t.words || t.text, note: { path: notePath, line: t.line, text: t.text, due: t.due }, line: t.text });
      }
    }
  } catch {
    // No relations to read: the project's own open steps still check.
  }

  const planned: Planned[] = [];
  const updates: string[] = [];
  // What each open step reads as while this call plans (earlier updates in the same call count).
  const current = p.next.map((s) => ({ ...s }));
  const tell = (line: string, updated: boolean) => (updated ? alreadyThereWords(line) : `already there: ${line.replace(/\s+/g, ' ').trim().slice(0, 80)}`);

  const projectUpdate = (cand: Cand, m: Miss): PlannedProjectUpdate => {
    const s = current[cand.projIndex!];
    const patch: { who?: string; when?: string; more?: string } = {};
    if (m.who && m.who !== (s.who ?? '').trim()) patch.who = m.who;
    if (m.whenStored && m.whenStored !== (s.when ?? '').trim()) {
      // A real date always wins; words (a state, an event condition) never write over one — only over nothing, or
      // over other words.
      const current = (s.when ?? '').trim();
      const currentDate = current ? resolveWriteWhen(current, now).when : undefined;
      if (m.iso || !current || !currentDate) patch.when = m.whenStored;
    }
    if (m.more && !(s.more ?? '').includes(m.more)) patch.more = s.more ? `${s.more}\n${m.more}` : m.more;
    const updated = Object.keys(patch).length > 0;
    if (updated) current[cand.projIndex!] = { ...s, ...patch };
    return { kind: 'update-project', index: cand.projIndex!, line: cand.line, patch, updated };
  };
  const noteUpdate = (cand: Cand, m: Miss): PlannedNoteUpdate => {
    const n = cand.note!;
    const patch: PlannedNoteUpdate['patch'] = {};
    if (m.who) patch.who = m.who;
    if (m.iso && m.iso !== n.due) patch.iso = m.iso;
    if (m.more) patch.detail = m.more;
    if (m.condition) patch.condition = m.condition;
    if (m.state) patch.state = m.state;
    const base = lineNow(index, n.path, n.line, n.text);
    const updated = updateNoteTaskLine(base, patch, now) !== base;
    return { kind: 'update-note', path: n.path, line: n.line, text: n.text, patch, display: n.text.replace(/\s+/g, ' ').trim().slice(0, 120), updated };
  };
  const mergeTwin = (cand: Cand, m: Miss): PlannedProjectUpdate => {
    // A twin of a step planned earlier in this call: its new parts join that line, never a second one.
    const item = cand.added!.item;
    let changed = false;
    if (m.who && !item.who) {
      item.who = m.who;
      changed = true;
    }
    if (m.whenStored && !item.when) {
      item.when = m.whenStored;
      changed = true;
    } else if (m.iso && item.when && !resolveWriteWhen(item.when, now).when) {
      // The twin names a real date where the line only held words: the date wins.
      item.when = m.whenStored!;
      changed = true;
    }
    if (m.more && !(item.more ?? '').includes(m.more)) {
      item.more = item.more ? `${item.more}\n${m.more}` : m.more;
      changed = true;
    }
    return { kind: 'update-project', index: -1, line: stepLine(item), patch: {}, updated: changed, merged: true };
  };
  const match = (cand: Cand, m: Miss): PlannedProjectUpdate | PlannedNoteUpdate => (cand.added ? mergeTwin(cand, m) : cand.projIndex !== undefined ? projectUpdate(cand, m) : noteUpdate(cand, m));

  // Exact first, in order; each miss stays pending so a twin later in the same call merges into it.
  const misses: Miss[] = [];
  const dead = new Set<PlannedAdd>();
  for (const raw of items) {
    const what = clean(raw.what);
    if (!what) continue;
    const r = resolveWriteWhen(raw.when, now);
    // Not a day at all (an event condition) stays in `when` as words: the row shows it, no reader dates it (detail
    // lines show nowhere on the project's page, so words filed there would vanish).
    const whenStored = r.when ?? (r.state ? stateWord(r.state) : (r.words ?? ''));
    const who = clean(raw.who, 80);
    const more = clean(raw.more, 2000);
    const pending: PlannedAdd = {
      kind: 'add',
      item: { what, ...(who ? { who } : {}), ...(whenStored ? { when: whenStored } : {}), ...(more ? { more } : {}) },
    };
    const m: Miss = {
      what,
      who,
      ...(whenStored ? { whenStored } : {}),
      ...(r.iso ? { iso: r.iso } : {}),
      ...(r.state ? { state: r.state } : {}),
      ...(pending.item.more ? { more: pending.item.more } : {}),
      ...(r.words ? { condition: r.words } : {}),
      at: planned.length,
      pending,
    };
    const key = normalizeTaskWhat(what);
    const exact = key ? cands.find((c) => c.key === key && !(c.added && dead.has(c.added))) : undefined;
    if (exact) {
      const u = match(exact, m);
      planned.push(u);
      updates.push(tell(u.kind === 'update-note' ? u.display : u.line, u.updated));
      continue;
    }
    planned.push(pending);
    misses.push(m);
    if (key) cands.push({ key, embedText: what, line: stepLine(pending.item), added: pending });
  }

  // The meaning pass: each miss against the open lines, at the strict bar. The model off, refusing, or stumbling
  // means exact only — every miss stays the new task it was planned as.
  if (misses.length && opts.embed) {
    const capped = cands.slice(0, MEANING_CANDS);
    const vecs = await embedAll(opts.embed, [...misses.map((m) => m.what), ...capped.map((c) => c.embedText)]);
    if (vecs) {
      const want = vecs.slice(0, misses.length);
      const have = vecs.slice(misses.length);
      const order = new Map<PlannedAdd, number>(misses.map((m, i) => [m.pending, i]));
      misses.forEach((m, i) => {
        // Its own line never matches itself; a twin merges only into an earlier line (a later one may yet move).
        const at = pickMeaningMatch(want[i], have, (idx) => {
          const cand = capped[idx];
          return !!cand.added && (cand.added === m.pending || dead.has(cand.added) || (order.get(cand.added) ?? -1) > i);
        });
        if (at < 0) return;
        const cand = capped[at];
        const u = match(cand, m);
        dead.add(m.pending);
        planned[m.at] = u;
        updates.push(tell(u.kind === 'update-note' ? u.display : u.line, u.updated));
      });
    }
  }
  return { planned: planned.filter((x) => x.kind !== 'add' || !dead.has(x)), updates };
}

/** A note line as it reads now (where it was, else the nearest line with the same words). */
function lineNow(index: VaultIndex, path: string, line: number, text: string): string {
  const content = index.content(path) ?? '';
  const lines = content.split(/\r?\n/);
  const at = locateAnyTask(lines, line, text);
  return lines[at >= 0 ? at : line] ?? `- [ ] ${text}`;
}

async function embedAll(embed: EmbedTexts, texts: string[]): Promise<number[][] | null> {
  const out: number[][] = [];
  try {
    for (let i = 0; i < texts.length; i += EMBED_BATCH) {
      const vecs = await embed(texts.slice(i, i + EMBED_BATCH));
      if (!vecs || vecs.length !== Math.min(EMBED_BATCH, texts.length - i)) return null;
      out.push(...vecs);
    }
    return out;
  } catch {
    return null;
  }
}

/** What a planned write says when anything matched (null: all fresh — the caller says its own words). */
export function plannedWords(planned: readonly Planned[], updates: readonly string[]): string | null {
  if (!updates.length) return null;
  const n = planned.filter((x) => x.kind === 'add').length;
  return [...(n ? [`Added ${n === 1 ? 'a next step' : `${n} next steps`}`] : []), ...updates].join('. ') + '.';
}

/** Planned project changes as the project-edit path takes them (an unchanged match plans no edit). */
export function plannedEdits(planned: readonly Planned[]): ProjectEdit[] {
  const out: ProjectEdit[] = [];
  for (const x of planned) {
    if (x.kind === 'add') out.push({ kind: 'add', list: 'next', item: x.item });
    else if (x.kind === 'update-project' && x.updated && x.index >= 0) out.push({ kind: 'change', list: 'next', index: x.index, item: x.patch });
  }
  return out;
}

/**
 * Planned note updates written, one write per note (grouped here, so two updates to one note never lose one). Lines
 * are found where they are now, and a line no longer there is left rather than guessed at.
 */
export async function writeNoteUpdates(
  index: VaultIndex,
  planned: readonly Planned[],
  write: (rel: string, text: string) => Promise<void>,
): Promise<{ rel: string; before: string; after: string }[]> {
  const byPath = new Map<string, PlannedNoteUpdate[]>();
  for (const x of planned) {
    if (x.kind !== 'update-note' || !x.updated) continue;
    byPath.set(x.path, [...(byPath.get(x.path) ?? []), x]);
  }
  const written: { rel: string; before: string; after: string }[] = [];
  const ref = new Date();
  for (const [rel, list] of byPath) {
    const content = index.content(rel);
    if (content === undefined) continue;
    const eol = content.includes('\r\n') ? '\r\n' : '\n';
    const lines = content.split(/\r?\n/);
    let changed = false;
    for (const u of list) {
      const at = locateAnyTask(lines, u.line, u.text);
      if (at < 0) continue;
      const next = updateNoteTaskLine(lines[at], u.patch, ref);
      if (next !== lines[at]) {
        lines[at] = next;
        changed = true;
      }
    }
    if (!changed) continue;
    const after = lines.join(eol);
    await write(rel, after);
    written.push({ rel, before: content, after });
  }
  return written;
}

// ── Where a note task goes ───────────────────────────────────────────────────────────────────────────────────────────

export interface RouteDeps {
  index: VaultIndex;
  dailyPath: string;
  projects(): { path: string; name: string; owner?: string; people: string[] }[];
}

export type NoteRoute = { kind: 'stay' } | { kind: 'project'; project: { path: string; name: string }; personNote: string; person: string } | { kind: 'inbox' };

/** → "Darcy"), '' when it names nobody. */
function ownerFromText(text: string): string {
  const tail = /\s+[—–]\s+(.+)$/.exec(String(text ?? '').trim());
  if (!tail) return '';
  const first = tail[1].split(/\s+·\s+/)[0]?.trim() ?? '';
  const name = first
    .replace(/!?\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_m, target: string, alias?: string) => (alias ?? target.split('/').pop() ?? target).trim())
    .replace(/^@/, '')
    .trim();
  return /^(by|due|before|on)\b/i.test(name) ? '' : name;
}

/**
 * Where a task asked onto a note goes: a person's page or the hub (today's note, the Inbox) routes onto the one
 * project that fits, with a plain pointer left on the person's page; no project fitting means the Inbox. Any other
 * note stays as asked. Never a guess: no person found, or two projects fitting, files nothing anywhere new.
 */
export function routeNoteTask(deps: RouteDeps, target: string, text: string): NoteRoute {
  const metas = deps.index.allMeta();
  const personTarget = metas.find((m) => m.path === target && isPersonNote(m.path, m.props));
  const hubTarget = target === deps.dailyPath || target === INBOX_NOTE;
  if (!personTarget && !hubTarget) return { kind: 'stay' };
  let personNote = '';
  let person = '';
  if (personTarget) {
    personNote = target;
    person = titleOf(target);
  } else {
    const seg = ownerFromText(text);
    const hit = seg ? metas.find((m) => isPersonNote(m.path, m.props) && namesPerson(titleOf(m.path), seg)) : undefined;
    if (!hit) return { kind: 'stay' };
    personNote = hit.path;
    person = titleOf(hit.path);
  }
  const fits = deps.projects().filter((x) => (x.owner && namesPerson(x.owner, person)) || x.people.some((m) => namesPerson(m, person)));
  if (fits.length !== 1) return { kind: 'inbox' };
  return { kind: 'project', project: { path: fits[0].path, name: fits[0].name }, personNote, person };
}
