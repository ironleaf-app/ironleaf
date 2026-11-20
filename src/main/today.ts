// Today (src/shared/today.ts): what the main side gives it — every project file and the notes, as the index has them, and
// later the files changed since yesterday in each project's folder on the PC (read as the project page reads them,
// src/main/projects.ts folderFiles, junk left out).

import { isProjectProps, parseProject, textVersion } from '../shared/project-file';
import { buildToday, isLive, type DueItem, type TodayData, type TodayFileInput, type UnscheduledItem, type WaitingItem } from '../shared/today';
import type { VaultIndex } from './indexer';
import { keptStepSources } from './one-task';
import { folderFiles } from './projects';
import { hereProject } from './project-places';
import { DOCS_FOLDER, isDocNote, parseDoc } from '../shared/doc-file';
import { sourceOf } from '../shared/unified-tasks';

const isProject = (props: Record<string, unknown> | undefined) => isProjectProps(props);

/** Today from the notes as they are now; `daily` is today's note by Settings › Daily notes. `templatesFolder`
 *  is Settings › General › Templates folder (its lines are templates, never a step's sources). */
export function todayData(index: VaultIndex, daily: { path: string; exists: boolean } | undefined, now = new Date(), templatesFolder = ''): TodayData {
  const metas = index.allMeta();
  const projects = metas
    .filter((m) => isProject(m.props))
    .map((m) => {
      const text = index.content(m.path) ?? '';
      return { path: m.path, version: textVersion(text), modified: m.mtime, project: parseProject(text, m.path) };
    });
  const notes = metas.map((m) => ({ path: m.path, title: m.label || m.title, mtime: m.mtime, props: m.props }));
  // Docs (src/shared/doc-file.ts): what changed in them, by the newest line in their Changes.
  const docs = metas
    .filter((m) => isDocNote(m.path, m.props, DOCS_FOLDER))
    .map((m) => {
      const d = parseDoc(index.content(m.path) ?? '', m.path);
      const c = d.changes[0];
      return { path: m.path, name: d.name || m.title, mtime: m.mtime, ...(d.about ? { about: d.about } : {}), ...(c ? { change: c.date ? `${c.date} — ${c.what}` : c.what } : {}) };
    });
  const data = buildToday({ projects, notes, docs, ...(daily ? { daily } : {}) }, now);
  // One job, one row (t249): a step the hub folds note lines into carries every source — the project's own
  // first, then where else it was written — so Today reads them under the row, as Tasks does.
  const folded = keptStepSources(index, templatesFolder, now);
  if (folded.size) {
    const attach = (items: readonly (DueItem | WaitingItem | UnscheduledItem)[]) => {
      for (const x of items) {
        if (x.index === undefined || ('kind' in x && x.kind !== 'step')) continue;
        const lines = folded.get(`${x.project}\n${x.index}`);
        if (!lines?.length) continue;
        x.sources = [sourceOf('project', x.project, x.projectName), ...lines];
      }
    };
    attach([...data.due.overdue, ...data.due.today, ...data.due.soon, ...data.due.later, ...data.due.stale, ...data.due.passed]);
    attach(data.waiting);
    attach(data.unscheduled);
  }
  return data;
}

/** The files changed since `since` in every live project's folder: a few folders at a time, newest first per project. */
export async function changedFiles(index: VaultIndex, since: number): Promise<TodayFileInput[]> {
  const jobs: { path: string; name: string; version: string; folder: string }[] = [];
  for (const m of index.allMeta()) {
    if (!isProject(m.props)) continue;
    const text = index.content(m.path) ?? '';
    // Its folder on this PC (src/main/project-places.ts): one on another PC isn't read here.
    const p = hereProject(parseProject(text, m.path));
    if (p.folder && isLive(p.status)) jobs.push({ path: m.path, name: p.name, version: textVersion(text), folder: p.folder });
  }
  const out: TodayFileInput[] = [];
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next++];
      try {
        const listing = await folderFiles(job.folder);
        for (const g of listing.groups)
          for (const f of g.files) if (f.modified >= since) out.push({ project: job.path, projectName: job.name, version: job.version, rel: f.rel, name: f.name, ext: f.ext, modified: f.modified });
      } catch (err) {
        // A folder that can't be read (a drive not there now) has nothing to say today, but the failure is logged:
        // silent skips hide real breakage (Nov 2026 audit).
        console.error('Today:', job.folder, err instanceof Error ? err.message : err);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, jobs.length) }, worker));
  return out;
}
