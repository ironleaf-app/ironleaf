// Today: the change sets waiting for review (10.0 Endless Tech, v2changes). One card per waiting set — what was asked,
// who asked, how many files wait — opening the review. Beside the agents' own requests, never in their place: a set the
// person never opens still waits after a restart. Styles: styles/changes.css.

import { useEffect, useState } from 'react';
import type { ChangeSetSummary } from '../../../shared/change-sets';
import { setAskWords, setFilesWords } from '../../../shared/change-sets';
import { openChanges } from '../state/actions';
import { Icon } from './Icon';

export function ChangesWaiting() {
  const [sets, setSets] = useState<ChangeSetSummary[] | null>(null);
  useEffect(() => {
    const load = () => void window.nv.changeSets.list().then(setSets, () => setSets([]));
    load();
    return window.nv.on.changeSets(load);
  }, []);
  const waiting = (sets ?? []).filter((s) => s.waiting > 0);
  if (!waiting.length) return null;
  return (
    <section className="cw-requests" aria-label="Changes waiting for review" data-look-row>
      <div className="ag-requests-head">
        <Icon name="review" size={15} />
        <span>{waiting.length === 1 ? 'A change set is waiting for review' : `${waiting.length} change sets are waiting for review`}</span>
      </div>
      {waiting.map((s) => (
        <article key={s.id} className="cw-card" aria-label={`${setAskWords(s)}: ${s.waiting} waiting`}>
          <div className="cw-main">
            <strong className="cw-ask">{setAskWords(s)}</strong>
            <span className="cw-meta">
              {s.askedBy} · {setFilesWords(s.files.length)} · {s.waiting} waiting
            </span>
          </div>
          <button type="button" className="button small" onClick={() => openChanges(s.id)}>
            Review
          </button>
        </article>
      ))}
    </section>
  );
}
