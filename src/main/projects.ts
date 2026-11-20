// Projects (docs/PROJECTS-DESIGN.md): every project file in the notes (src/shared/project-file.ts), one project with what
// belongs to it (its activity, its other notes, its folder's files live from the PC), and changes written back. The
// window's Projects home and project pages, and the assistant, use these.

import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { readProps } from '../shared/frontmatter';
import { hasProjectSubstance, isProjectProps, openSteps, parseProject, projectOwnsFolder, serializeProject, textVersion, type Project, type ProjectPerson } from '../shared/project-file';
import { findTasks } from '../shared/hub';
import type { FolderProjectOffer, ProjectCard, ProjectFile, ProjectFiles, ProjectView } from '../shared/types';
import type { VaultIndex } from './indexer';
import { isLogProps, layoutLine, layoutOf, logsFor, parseBlocks, parseLog, type LogNote } from '../shared/layouts';
import { hereProject, isAppData, projectPlace, shouldSkipFile, skipDir } from './project-places';
import { hubModel } from '../shared/project-hub';
import { standingLine } from '../shared/project-standing';
import { connectedActions } from '../shared/records';
import { todayDay } from '../shared/timeline';
import { whoIsMe } from '../shared/today';

const isProjectMeta = (props: Record<string, unknown>) => isProjectProps(props);

export class Projects {
  constructor(private index: VaultIndex) {}

  /** Every log note (type: log), read: what layouts chart (docs/LAYOUTS.md). */
  logs(today = new Date()): (LogNote & { path: string })[] {
    const out: (LogNote & { path: string })[] = [];
    for (const meta of this.index.allMeta()) {
      if (!isLogProps(meta.props)) continue;
      out.push({ ...parseLog(this.index.content(meta.path) ?? '', today), path: meta.path, title: meta.title });
    }
    return out;
  }

  /** Every project, for the Projects home: its facts at a glance (and its layout's one line). */
  list(): ProjectCard[] {
    const out: ProjectCard[] = [];
    const today = new Date();
    let logs: (LogNote & { path: string })[] | null = null;
    // "For you" is the vault's person (the owner of most live projects), read the Today's way, so the Projects
    // home's late counts and Next-for-you lines match Today and the project page (29 Oct 2026, redesign).
    const metas = [...this.index.allMeta()];
    const parsed = metas.filter((meta) => isProjectMeta(meta.props)).map((meta) => ({ meta, p: hereProject(parseProject(this.index.content(meta.path) ?? '', meta.path)) }));
    const me = whoIsMe(parsed.map((x) => x.p)) ?? undefined;
    const todayD = todayDay(today);
    // The connected vault's actions written in meetings and notes (p10-vault-connected C4, 4 Nov 2026):
    // Home counts late like the project page, from the same hub with the same connected actions.
    let model: ReturnType<VaultIndex['records']> | null = null;
    for (const { meta, p } of parsed) {
      const props = (meta.props ?? {}) as Record<string, unknown>;
      const layout = layoutOf(props);
      let line: ProjectCard['line'];
      if (layout || parseBlocks(props.blocks).length) {
        logs ??= this.logs(today);
        line = layoutLine({ project: p, props, logs: logsFor(logs, p.name, meta.path), today }) ?? undefined;
      }
      // Its next step: What's next, else a run sheet's first open box.
      const open = openSteps(p);
      const order = ['critical', 'high', 'medium', 'low'];
      const top = p.risks.map((r) => r.level ?? '').filter(Boolean).sort((a, b) => order.indexOf(a) - order.indexOf(b))[0];
      let connected: ReturnType<typeof connectedActions> = [];
      try {
        model ??= this.index.records();
        connected = connectedActions(model, meta.path);
      } catch {
        connected = [];
      }
      const own = hubModel({ project: p, today: todayD, ...(me ? { me } : {}), connected });
      // Its open rows as its page counts them (t249: the standing line's yours plus others', steps and the
      // actions written in meetings and notes — never the file's steps alone, never 16 on home by 19 open).
      const counts = standingLine(own);
      // Claimed but unworked, in an empty owned folder: offered back as "Project files to check", never unmade on
      // its own. Templates are blank by design, never thin.
      const dir = projectOwnsFolder(meta.path) ? meta.path.slice(0, meta.path.lastIndexOf('/')) : '';
      const owned = dir ? metas.filter((m) => m.path !== meta.path && m.path.startsWith(`${dir}/`)).length : 0;
      const thin = !hasProjectSubstance(p) && owned === 0 && !meta.path.split('/').some((s) => s.toLowerCase() === 'templates');
      out.push({ path: meta.path, name: p.name, status: p.status, health: p.health, progress: p.progress, owner: p.owner, due: p.due, updated: p.updated, folder: p.folder, tags: p.tags, next: open[0], ...(own.next ? { nextMine: own.next.what, ...(own.next.when ? { nextMineWhen: own.next.when } : {}) } : {}), lateMine: own.plan.late.length, openNext: counts.mineOpen + counts.othersOpen, risks: p.risks.length, topRisk: top, modified: meta.mtime, ...(layout ? { layout } : {}), ...(line ? { line } : {}), ...(thin ? { thin: true as const } : {}) });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Folders that read like projects but claim nothing (5 Nov 2026, u3 moving-in): directly under Projects/, with
   *  notes and an open task, no project file of their own and the owned name free. Offered on the Projects home —
   *  never made on their own. */
  folderOffers(): FolderProjectOffer[] {
    const today = new Date();
    const byFolder = new Map<string, { notes: number; tasks: number; claimed: boolean; name: string }>();
    for (const meta of this.index.allMeta()) {
      if (!/\.md$/i.test(meta.path)) continue;
      const segs = meta.path.split('/');
      if (segs.length < 3 || segs[0].toLowerCase() !== 'projects') continue;
      const folder = `${segs[0]}/${segs[1]}`;
      if (folder.split('/').some((s) => s.toLowerCase() === 'templates')) continue;
      let g = byFolder.get(folder);
      if (!g) { g = { notes: 0, tasks: 0, claimed: false, name: segs[1] }; byFolder.set(folder, g); }
      // The owned name taken, by a project file or a plain note: nothing to offer (the file lands there).
      if (segs.length === 3 && segs[2].replace(/\.md$/i, '').trim().toLowerCase() === segs[1].trim().toLowerCase()) {
        g.claimed = true;
        continue;
      }
      if (isProjectMeta(meta.props)) { g.claimed = true; continue; }
      g.notes++;
      try {
        g.tasks += findTasks(this.index.content(meta.path) ?? '', today).length;
      } catch {
        // Counted, its tasks unknown.
      }
    }
    return [...byFolder.entries()]
      .filter(([, g]) => !g.claimed && g.notes > 0 && g.tasks > 0)
      .map(([folder, g]) => ({ folder, name: g.name, notes: g.notes, tasks: g.tasks }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Every project in full, as its file reads now, with its fingerprint (the timeline: src/shared/timeline.ts). */
  all(): { path: string; version: string; project: Project }[] {
    const out: { path: string; version: string; project: Project }[] = [];
    for (const meta of this.index.allMeta()) {
      if (!isProjectMeta(meta.props)) continue;
      const text = this.index.content(meta.path) ?? '';
      out.push({ path: meta.path, version: textVersion(text), project: hereProject(parseProject(text, meta.path)) });
    }
    return out;
  }

  /** One project with what belongs to it. */
  view(projectPath: string): ProjectView {
    const text = this.index.content(projectPath);
    if (text === undefined) throw new Error('That project isn’t there any more.');
    // Its folder as this PC reaches it, and where that is (on another PC: the page offers the choices). The note itself
    // keeps the folder as written: changes are made on the file's own text (changed()).
    const written = parseProject(text, projectPath);
    const project = hereProject(written);
    const place = projectPlace(written);
    // Only an owned folder's notes list as the project's (5 Nov 2026, u3 moving-in: a coincidental project file
    // claimed its folder, pulling unrelated notes' tasks onto its page). Elsewhere the page keeps its file, its
    // backlinks, and what names it deliberately.
    const dir = projectOwnsFolder(projectPath) ? projectPath.slice(0, projectPath.lastIndexOf('/')) : '';
    const notes: ProjectView['notes'] = [];
    const activity: ProjectView['activity'] = [];
    if (dir) {
      for (const meta of this.index.allMeta()) {
        if (meta.path === projectPath || !meta.path.startsWith(`${dir}/`)) continue;
        const entry = { path: meta.path, title: meta.title, modified: meta.mtime };
        // Activity or Tasks as a folder or the file's own name, in any case ("Activity.md", "activity/").
        const segs = meta.path.slice(dir.length).split('/').filter(Boolean);
        const inActivity = segs.slice(0, -1).some((s) => /^(activity|tasks)$/i.test(s)) || /^(activity|tasks)\.[a-z0-9]+$/i.test(segs[segs.length - 1] ?? '');
        if (inActivity) activity.push({ ...entry, status: typeof meta.props?.status === 'string' ? meta.props.status : undefined });
        else notes.push(entry);
      }
    }
    // Its notes elsewhere: members (a `project` property naming it, or named in its own file), counted; the rest
    // link here and show as see-also, never counted (5 Nov 2026, v9-vault-truth: every bare link counted, so an
    // ordinary project read "Tasks 77, Notes 42"). Another project is never a note: it stays see-also.
    const named = new Set(this.index.linksFrom(projectPath));
    const membered = new Map<string, { path: string; title: string; modified: number }>();
    const linkedFrom: { path: string; title: string }[] = [];
    const back = new Map<string, { title: string; prop: boolean }>();
    for (const b of this.index.backlinks(projectPath).filter((b) => !dir || !b.source.startsWith(`${dir}/`))) {
      const kept = back.get(b.source);
      back.set(b.source, { title: kept?.title ?? this.index.get(b.source)?.label ?? b.sourceTitle, prop: (kept?.prop ?? false) || b.prop === 'project' || b.prop === 'projects' });
    }
    for (const [source, hit] of back) {
      const entry = { path: source, title: hit.title };
      const kind = String(this.index.get(source)?.props?.type ?? '').toLowerCase();
      if (kind !== 'project' && kind !== 'hub' && (hit.prop || named.has(source))) membered.set(source, { ...entry, modified: this.index.get(source)?.mtime ?? 0 });
      else linkedFrom.push(entry);
    }
    for (const claimed of named) {
      // Named in its file but linking nowhere back: still a member (its Documents, say), unless a project itself.
      if (dir && claimed.startsWith(`${dir}/`)) continue;
      if (membered.has(claimed) || linkedFrom.some((l) => l.path === claimed)) continue;
      const meta = this.index.get(claimed);
      if (!meta) continue;
      const kind = String(meta.props?.type ?? '').toLowerCase();
      if (kind === 'project' || kind === 'hub') continue;
      membered.set(claimed, { path: claimed, title: meta.label, modified: meta.mtime });
    }
    notes.push(...membered.values());
    const props = (this.index.get(projectPath)?.props ?? readProps(text)) as Record<string, unknown>;
    const logs = logsFor(this.logs(), project.name, projectPath);
    const ordered = activity.sort((a, b) => b.modified - a.modified);
    return { path: projectPath, version: textVersion(text), project, ...(place ? { place } : {}), props, logs, notes: notes.sort((a, b) => b.modified - a.modified), activity: ordered.slice(0, 30), activityTotal: ordered.length, activityMore: Math.max(0, ordered.length - 30), linkedFrom, known: this.known() };
  }

  /** People (with the part they play most often), owners and tags across every project: what the page suggests. */
  known(): { people: ProjectPerson[]; tags: string[] } {
    const people = new Map<string, { name: string; roles: Map<string, number>; count: number }>();
    const tags = new Map<string, number>();
    const add = (name: string, role?: string) => {
      const key = name.trim().toLowerCase();
      if (!key) return;
      const entry = people.get(key) ?? { name: name.trim(), roles: new Map(), count: 0 };
      entry.count++;
      if (role) entry.roles.set(role, (entry.roles.get(role) ?? 0) + 1);
      people.set(key, entry);
    };
    for (const meta of this.index.allMeta()) {
      if (!isProjectMeta(meta.props)) continue;
      const p = parseProject(this.index.content(meta.path) ?? '', meta.path);
      if (p.owner) add(p.owner);
      for (const x of p.people) add(x.name, x.role);
      for (const n of p.next) if (n.who) add(n.who);
      for (const t of p.tags) tags.set(t, (tags.get(t) ?? 0) + 1);
    }
    return {
      people: [...people.values()]
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
        .slice(0, 300)
        .map((e) => {
          const role = [...e.roles.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
          return role ? { name: e.name, role } : { name: e.name };
        }),
      tags: [...tags.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t).slice(0, 200),
    };
  }

  /** The project file with changes made (by the window or the assistant): its text, written by the caller. */
  changed(projectPath: string, change: (p: Project) => void): { before: string; after: string } {
    const before = this.index.content(projectPath);
    if (before === undefined) throw new Error('That project isn’t there any more.');
    const p = parseProject(before, projectPath);
    change(p);
    return { before, after: serializeProject(p, before) };
  }
}

/**
 * Every file in a project's folder, live from the PC, newest first (at most `depth` folders down): what the page lists
 * and what search reads inside (src/main/file-index.ts). Hidden files, Office's own "~$" files, shortcuts, links
 * (never followed out of the folder) and junk folders are left out. Null when the folder isn't there.
 */
export async function walkFolder(folder: string, depth = 4): Promise<ProjectFile[] | null> {
  try {
    if (!(await stat(folder)).isDirectory()) return null;
  } catch {
    return null;
  }
  const all: ProjectFile[] = [];
  const walk = async (dir: string, level: number) => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name.startsWith('~$') || e.isSymbolicLink()) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (skipDir(e.name) || level >= depth || (await isAppData(abs))) continue;
        await walk(abs, level + 1);
      } else if (e.isFile() && !shouldSkipFile(e.name)) {
        try {
          const s = await stat(abs);
          const rel = path.relative(folder, abs).split(path.sep).join('/');
          all.push({ rel, name: e.name, ext: path.extname(e.name).slice(1).toLowerCase(), size: s.size, modified: s.mtimeMs, created: s.birthtimeMs || s.ctimeMs });
        } catch {
          // Gone while being listed.
        }
      }
    }
  };
  await walk(folder, 1);
  return all.sort((a, b) => b.modified - a.modified);
}

/** A project folder's files, live from the PC: grouped by subfolder as on disk, newest first; junk left out. */
export async function folderFiles(folder: string, { depth = 4, limit = 3000 } = {}): Promise<ProjectFiles> {
  const all = await walkFolder(folder, depth);
  return all ? groupFiles(folder, all, limit) : { folder, exists: false, groups: [], total: 0, more: 0 };
}

/** Files (newest first) as the page groups them: by their top folder, the folder's own files first, then subfolders by
 *  their newest file (what's being worked on comes up). A remote project's files are grouped the same way. */
export function groupFiles(folder: string, all: ProjectFile[], limit = 3000): ProjectFiles {
  const sorted = [...all].sort((a, b) => b.modified - a.modified);
  const groups = new Map<string, ProjectFile[]>();
  for (const f of sorted.slice(0, limit)) {
    const top = f.rel.includes('/') ? f.rel.slice(0, f.rel.indexOf('/')) : '';
    if (!groups.has(top)) groups.set(top, []);
    groups.get(top)!.push(f);
  }
  return {
    folder,
    exists: true,
    total: sorted.length,
    more: Math.max(0, sorted.length - limit),
    groups: [...groups.entries()].sort((a, b) => (a[0] === '' ? -1 : b[0] === '' ? 1 : b[1][0].modified - a[1][0].modified)).map(([name, files]) => ({ name, files })),
  };
}

/** A path inside a project's folder (never outside it). Only ".." as a whole segment escapes ("..foo" is a name). */
export function insideFolder(folder: string, rel: string): string {
  const abs = path.resolve(folder, rel);
  const r = path.relative(path.resolve(folder), abs);
  if (!r || r === '..' || r.startsWith(`..${path.sep}`) || path.isAbsolute(r)) throw new Error('That file isn’t in the project’s folder.');
  return abs;
}

/**
 * Each project's changes, to undo and redo from its page (Ctrl+Z, the Undo in a change's message): the person's own and
 * the assistant's, in one history, kept while Ironleaf is open. Every version also goes to file recovery, so older ones
 * stay to look back on after that. A change that moved the project (a new name) carries its moves.
 */
export interface ProjectStep {
  before: string;
  after: string;
  words: string;
  /** 'you', 'assistant', or an AI agent's name ("Research agent (agent)": src/main/agent-access.ts). */
  by: string;
  /** Renaming moves its folder and file: [from, to] in order, the project file's path going from the first to the last. */
  moves?: [string, string][];
  /** One task, one row (p13-one-task): the project's notes the change closed lines in, each before and after — one
   *  change, so one Undo restores all of them. */
  notes?: { path: string; before: string; after: string }[];
}

export class ProjectHistory {
  private done = new Map<string, ProjectStep[]>();
  private undone = new Map<string, ProjectStep[]>();
  constructor(private readonly max = 100) {}

  record(file: string, step: ProjectStep): void {
    if (step.before === step.after && !step.moves?.length) return;
    const list = this.done.get(file) ?? [];
    list.push(step);
    if (list.length > this.max) list.splice(0, list.length - this.max);
    this.done.set(file, list);
    this.undone.delete(file);
  }

  /** The step Undo (or Redo) would take back (or make again). */
  peek(file: string, redo = false): ProjectStep | undefined {
    return (redo ? this.undone : this.done).get(file)?.at(-1);
  }

  /** Takes the step off one list and onto the other (it was undone, or made again), under the file's path now. */
  shift(file: string, redo: boolean, now = file): ProjectStep | undefined {
    const from = redo ? this.undone : this.done;
    const to = redo ? this.done : this.undone;
    const step = from.get(file)?.pop();
    if (!step) return undefined;
    if (now !== file) this.renamed(file, now);
    const list = to.get(now) ?? [];
    list.push(step);
    to.set(now, list);
    return step;
  }

  /** The project's file moved: its history follows it. */
  renamed(from: string, to: string): void {
    for (const map of [this.done, this.undone]) {
      const list = map.get(from);
      if (!list) continue;
      map.delete(from);
      map.set(to, [...(map.get(to) ?? []), ...list]);
    }
  }

  /** The file changed some other way (edited as a note): its steps no longer fit it. */
  forget(file: string): void {
    this.done.delete(file);
    this.undone.delete(file);
  }

  counts(file: string): { undo: number; redo: number } {
    return { undo: this.done.get(file)?.length ?? 0, redo: this.undone.get(file)?.length ?? 0 };
  }
}
