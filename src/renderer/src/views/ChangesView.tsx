// Changes waiting (10.0 Endless Tech, v2changes: "ask for several changes and review them once as a set"). Proposed
// change sets wait here as one: each file with its words before and after, Accept all, Accept this, Reject. Accepting
// writes through the guarded write; a file changed since it was proposed is left as it is. The sets live on disk, so
// what waits is still here after a restart. Styles: styles/changes.css (the diff rows reuse the earlier versions'
// own, styles/suggestions.css).

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ChangeSet, ChangeSetSummary } from '../../../shared/change-sets';
import { setAskWords, setFilesWords, staleWords } from '../../../shared/change-sets';
import { changeRows } from '../../../shared/note-diff';
import * as A from '../state/actions';
import { showError, toast, useApp } from '../state/store';
import type { TabState } from '../state/workspace';
import { EmptyState, LoadingRows } from '../components/EmptyState';
import { Icon } from '../components/Icon';
import { noticeWhen } from '../panels/NoticeBell';

/** Above this many diff rows the rest folds into one line (a whole new file is still reviewed, not scrolled forever). */
const MAX_ROWS = 240;

/** One file's before and after, line by line: lines taken out struck through, lines put in tinted. */
function FileDiff({ base, after }: { base: string | null; after: string }) {
  const rows = useMemo(() => changeRows(base ?? '', after), [base, after]);
  const shown = rows.slice(0, MAX_ROWS);
  const more = rows.length - shown.length;
  return (
    <div className="recovery-diff" role="list" aria-label="What would change">
      {base === null && <div className="recovery-diff-gap" role="listitem">A new file</div>}
      {shown.map((r, i) =>
        r.kind === 'gap' ? (
          <div key={i} className="recovery-diff-gap" role="listitem">
            {r.count === 1 ? '1 line the same' : `${r.count} lines the same`}
          </div>
        ) : (
          <div key={i} className={`recovery-diff-line is-${r.kind}`} role="listitem" aria-label={r.kind === 'add' ? 'Added' : r.kind === 'del' ? 'Taken out' : undefined}>
            <span className="recovery-diff-sign" aria-hidden="true">{r.kind === 'add' ? '+' : r.kind === 'del' ? '−' : ''}</span>
            <span className="recovery-diff-text">{r.text || ' '}</span>
          </div>
        ),
      )}
      {more > 0 && <div className="recovery-diff-gap" role="listitem">{more} more changed lines</div>}
    </div>
  );
}

const stateWords = (s: ChangeSetSummary['files'][number]['state']) => (s === 'accepted' ? 'Accepted' : s === 'rejected' ? 'Rejected, left as it is' : s === 'stale' ? 'Changed since' : 'Waiting');

export function ChangesView({ tab }: { tab: TabState }) {
  const canEdit = useApp((s) => s.canEdit);
  const [sets, setSets] = useState<ChangeSetSummary[] | null>(null);
  const [full, setFull] = useState<ChangeSet | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  // The open set: the one asked for (a Today card, the chat's set link) follows the tab; picking another stays.
  const [sel, setSel] = useState<string | null>(tab.path ?? null);
  useEffect(() => {
    if (tab.path) setSel(tab.path);
  }, [tab.path]);

  const loadList = useCallback(() => {
    void window.nv.changeSets
      .list()
      .then((l) => {
        setSets(l);
        setFailed(false);
      })
      .catch(() => {
        setFailed(true);
      });
  }, []);
  const loadFull = useCallback((id: string) => {
    setSel(id);
    void window.nv.changeSets
      .get(id)
      .then((s) => setFull(s))
      .catch(() => setFull(null));
  }, []);

  useEffect(() => {
    loadList();
    return window.nv.on.changeSets(() => {
      loadList();
      setSel((cur) => {
        if (cur) void window.nv.changeSets.get(cur).then(setFull, () => setFull(null));
        return cur;
      });
    });
  }, [loadList]);
  // The asked-for set, else the newest still waiting, opened in full (picking another stays picked).
  useEffect(() => {
    if (!sets) return;
    if (full && sel === full.id) return;
    const id = sel && sets.some((s) => s.id === sel) ? sel : (sets.find((s) => s.waiting > 0) ?? sets[0])?.id;
    if (id) loadFull(id);
    else setFull(null);
  }, [sets, full, sel, loadFull]);

  const run = (fn: () => Promise<{ words: string }>) => {
    if (busy) return;
    setBusy(true);
    void fn().then(
      (r) => {
        setBusy(false);
        toast(r.words);
        loadList();
        if (full) loadFull(full.id);
      },
      (err: unknown) => {
        setBusy(false);
        showError(err);
      },
    );
  };

  if (sets === null) {
    return (
      <div className="cs-page">
        <div className="cs-head">
          <h2 className="cs-title">Changes waiting</h2>
        </div>
        {failed ? <p className="cs-failed">The waiting changes couldn’t be read just now.</p> : <LoadingRows rows={3} />}
      </div>
    );
  }
  if (!sets.length) {
    return (
      <div className="cs-page">
        <div className="cs-head">
          <h2 className="cs-title">Changes waiting</h2>
          <p className="cs-sub">Proposed changes wait here to be reviewed once as a set.</p>
        </div>
        <EmptyState icon="review" title="Nothing is waiting for review." line="When another AI app proposes changes, they wait here as one set." />
      </div>
    );
  }
  const waiting = sets.reduce((n, s) => n + s.waiting, 0);
  return (
    <div className="cs-page">
      <div className="cs-head">
        <h2 className="cs-title">Changes waiting</h2>
        <p className="cs-sub">{waiting === 0 ? 'Nothing left to decide.' : `${waiting} ${waiting === 1 ? 'file waits' : 'files wait'} for review${sets.length === 1 ? '' : ` in ${sets.length} sets`}.`}</p>
      </div>
      <div className="cs-body">
        <div className="cs-list" role="list" aria-label="Change sets">
          {sets.map((s) => (
            <button key={s.id} aria-current={full?.id === s.id ? 'true' : undefined} className={`cs-set${full?.id === s.id ? ' is-open' : ''}`} onClick={() => loadFull(s.id)}>
              <span className="cs-set-ask">{setAskWords(s)}</span>
              <span className="cs-set-meta">
                {s.askedBy} · {setFilesWords(s.files.length)}
                {s.waiting > 0 ? ` · ${s.waiting} waiting` : ' · decided'} · {noticeWhen(s.at)}
              </span>
              {s.waiting > 0 && <span className="cs-dot" aria-label="Needs you" />}
            </button>
          ))}
        </div>
        <div className="cs-detail">
          {!full ? (
            <p className="cs-failed">That change set isn’t here any more.</p>
          ) : (
            <>
              <div className="cs-detail-head">
                <div>
                  <h3 className="cs-ask">{setAskWords(full)}</h3>
                  <p className="cs-meta">
                    {full.askedBy} · {setFilesWords(full.entries.length)} · {noticeWhen(full.at)}
                  </p>
                </div>
                {(full.entries.some((e) => e.state === 'waiting' || e.state === 'stale')) && (
                  <div className="cs-actions">
                    <button type="button" className="button primary" disabled={!canEdit || busy} onClick={() => run(() => window.nv.changeSets.accept(full.id))}>
                      <Icon name="check" size={14} /> Accept all
                    </button>
                    <button type="button" className="button" disabled={!canEdit || busy} onClick={() => run(() => window.nv.changeSets.reject(full.id))}>
                      Reject
                    </button>
                  </div>
                )}
              </div>
              {full.entries.map((e) => (
                <article key={e.id} className={`cs-file is-${e.state}`} aria-label={`${e.name}: ${stateWords(e.state)}`}>
                  <header className="cs-file-head">
                    <button type="button" className="cs-file-name" title={`${e.path} (as it is now)`} onClick={() => A.openPath(e.path)}>
                      {e.name}
                    </button>
                    <span className={`cs-state is-${e.state}`}>{stateWords(e.state)}</span>
                    <span className="cs-file-space" />
                    {(e.state === 'waiting' || e.state === 'stale') && (
                      <>
                        <button type="button" className="button small primary" disabled={!canEdit || busy} onClick={() => run(() => window.nv.changeSets.accept(full.id, e.id))}>
                          Accept this
                        </button>
                        <button type="button" className="button small" disabled={!canEdit || busy} onClick={() => run(() => window.nv.changeSets.reject(full.id, e.id))}>
                          Reject
                        </button>
                      </>
                    )}
                  </header>
                  {e.state === 'stale' && <p className="cs-stale">{staleWords(e.name)}</p>}
                  {e.changes.length > 0 && (
                    <ul className="cs-changes">
                      {e.changes.map((c, i) => (
                        <li key={i}>{c}</li>
                      ))}
                    </ul>
                  )}
                  {(e.state === 'waiting' || e.state === 'stale') && <FileDiff base={e.base} after={e.after} />}
                </article>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
