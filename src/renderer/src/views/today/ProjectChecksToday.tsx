// Projects waiting from their notes, on Today (10.0 item 19): each live project with standing checks (a stale
// decision, a risk with no owner, a slipped date) or catch-up proposals from its changed notes waits on its page's
// review. One row for all of them (8 Nov 2026, calm list: "12 projects have notes waiting"), opening the list with
// every project and its Open; the counts are the page's own (`projects:checks`, dismissal-aware).

import { useEffect, useState } from 'react';
import { catchupWords, projectsWaitingWords, type ProjectCheckState } from '../../../../shared/project-checks';
import { LookRow } from '../../components/LookRow';
import { openPath } from '../../state/actions';
import { useApp } from '../../state/store';
import { readDismissedKeys } from '../project/ProjectChecks';

export function ProjectChecksToday() {
  const revision = useApp((s) => s.revision);
  const [states, setStates] = useState<ProjectCheckState[] | null>(null);
  useEffect(() => {
    let live = true;
    window.nv.projects
      .checks()
      .then((all) => live && setStates(all), () => live && setStates([]));
    return () => void (live = false);
  }, [revision]);
  if (!states) return null;
  const rows = states
    .map((s) => ({ s, waiting: s.proposals.filter((p) => !readDismissedKeys(s.path).has(p.key)) }))
    .filter((r) => r.waiting.length > 0 || r.s.checks.length > 0)
    .sort((a, b) => b.waiting.length + b.s.checks.length - (a.waiting.length + a.s.checks.length) || a.s.name.localeCompare(b.s.name));
  if (!rows.length) return null;
  return (
    <LookRow title={projectsWaitingWords(rows.length)}>
      <ul className="rm-today-rows">
        {rows.map(({ s, waiting }) => (
          <li key={s.path} className="rm-today-row">
            <button type="button" className="rm-today-main" onClick={() => openPath(s.path)} title={`Open ${s.name}`}>
              <span className="rm-today-name">{s.name}</span>
              <span className="rm-today-sub">{catchupWords({ proposals: waiting.length, checks: s.checks.length, ...(s.updated ? { updated: s.updated } : {}) })}</span>
            </button>
            <button type="button" className="button small" onClick={() => openPath(s.path)}>
              Open
            </button>
          </li>
        ))}
      </ul>
    </LookRow>
  );
}
