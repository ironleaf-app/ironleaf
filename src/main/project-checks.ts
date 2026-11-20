// Catch-up checks for every project, on the main side (10.0 item 19: "a project page that keeps itself up to
// date"). One call gathers what the project pages and Today show: each live project's standing checks (a stale
// decision, a risk with no owner, a slipped date) and its catch-up proposals from the notes changed since it was last
// updated. The groupings are the project page's own (Projects.view: its folder's notes and the notes linking to it),
// the judgements are the shared pure ones (src/shared/project-checks.ts), and the notes are read from the index in
// memory. Cached per index generation (the page and Today ask on every paint; the work runs only when the notes
// changed). Nothing here writes: accepting is the person's tap, through the project's own edits.

import { isFinished } from '../shared/finished';
import { catchUpProposals, notesForCatchup, standingChecks, type CheckNoteMeta, type ProjectCheckState } from '../shared/project-checks';
import type { VaultIndex } from './indexer';
import type { Projects } from './projects';

export type { ProjectCheckState };

export function projectChecksFor(projects: Projects, index: VaultIndex, now: Date = new Date()): ProjectCheckState[] {
  const out: ProjectCheckState[] = [];
  for (const c of projects.list()) {
    try {
      // Finished projects keep nothing waiting (their page stays as it was).
      if (isFinished(c.status)) continue;
      const v = projects.view(c.path);
      const metas: CheckNoteMeta[] = [...v.notes];
      for (const l of v.linkedFrom) {
        const mtime = index.get(l.path)?.mtime;
        // Linked, not the project's own (8 Nov 2026, calm Today): marked so the shared rule drops them —
        // waiting counts real tasks on the project, never bare links' boxes.
        if (mtime !== undefined) metas.push({ path: l.path, title: l.title, modified: mtime, linked: true });
      }
      const changed = notesForCatchup(metas, v.project.updated, now);
      const withContent = [];
      for (const n of changed) {
        const content = index.content(n.path);
        if (content !== undefined) withContent.push({ ...n, content });
      }
      out.push({
        path: v.path,
        name: v.project.name,
        ...(v.project.updated ? { updated: v.project.updated } : {}),
        checks: standingChecks(v.project, now),
        proposals: catchUpProposals(v.project, withContent, now),
      });
    } catch (err) {
      // One project's checks never stop the rest, but the failure is logged: silent skips hide breakage.
      console.error('Project checks:', c.path, err instanceof Error ? err.message : err);
    }
  }
  return out;
}

/** The checks as `projects:checks` serves them, cached until the notes change. */
export function createProjectChecks(projects: Projects, index: VaultIndex): { checks(now?: Date): ProjectCheckState[] } {
  let cache: { generation: number; day: string; states: ProjectCheckState[] } | null = null;
  return {
    checks(now: Date = new Date()) {
      const generation = index.generation();
      // Days matter too (a date slips overnight with no edit): the cache lasts the day, not forever.
      const day = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
      if (cache && cache.generation === generation && cache.day === day) return cache.states;
      const states = projectChecksFor(projects, index, now);
      cache = { generation, day, states };
      return states;
    },
  };
}
