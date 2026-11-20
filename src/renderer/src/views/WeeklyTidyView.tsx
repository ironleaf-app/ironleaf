// The weekly tidy (2 Nov 2026, 10.0 plan item 21): this week's proposal as one review list. Each waiting line says what
// its fix does, with its own fix button and Skip; Apply all runs every waiting line, and every applied fix can be undone.
// Nothing is ever deleted for good: emptied and merged-away notes go to Recently deleted. Opened from Today, Settings,
// the bell, or the palette (Open the weekly tidy).

import { useCallback, useEffect, useState } from 'react';
import type { TidyLine, TidyProposal } from '../../../main/weekly-tidy';
import { tidyApplyWords } from '../../../shared/weekly-tidy';
import { EmptyState } from '../components/EmptyState';
import { Icon } from '../components/Icon';
import { openMenu } from '../components/Menu';
import { errorMessage } from '../lib/errors';
import { headerOverflowHidden, overflowMenuItems } from '../lib/headerOverflow';
import * as A from '../state/actions';
import type * as W from '../state/workspace';
import { showError, toast, useApp } from '../state/store';
import { ViewHeader } from './ViewHeader';

const KIND_WORDS: Record<TidyLine['kind'], string> = {
  duplicate: 'Duplicates',
  'broken-link': 'Broken links',
  empty: 'Empty notes',
  thin: 'Thin notes',
  'wrong-place': 'Wrong place',
  'stale-reminder': 'Stale reminders',
};

const shortName = (p: string) => (p.split('/').pop() ?? p).replace(/\.md$/i, '');

function whenPrepared(at: number): string {
  const d = new Date(at);
  return d.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' });
}

export function WeeklyTidyView({ tab }: { tab: W.TabState }) {
  const canEdit = useApp((s) => s.canEdit);
  const [proposal, setProposal] = useState<TidyProposal | null | undefined>(undefined);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try {
      setProposal(await window.nv.tidy.get());
      setError('');
    } catch (e) {
      setError(errorMessage(e));
      setProposal(null);
    }
  }, []);
  useEffect(() => {
    void load();
    return window.nv.on.tidyChanged(() => void load());
  }, [load]);

  const apply = async (line: TidyLine) => {
    setBusy(line.id);
    try {
      const r = await window.nv.tidy.apply(line.id);
      toast(r.words, { label: 'Undo', run: () => void undo(line.id) });
      void load();
    } catch (e) {
      showError(e);
      void load();
    } finally {
      setBusy('');
    }
  };
  const skip = async (line: TidyLine) => {
    setBusy(line.id);
    try {
      await window.nv.tidy.skip(line.id);
      void load();
    } catch (e) {
      showError(e);
    } finally {
      setBusy('');
    }
  };
  const undo = async (id: string) => {
    setBusy(id);
    try {
      const r = await window.nv.tidy.undo(id);
      toast(r.words);
      void load();
    } catch (e) {
      showError(e);
    } finally {
      setBusy('');
    }
  };
  const applyAll = async () => {
    setBusy('all');
    try {
      const r = await window.nv.tidy.applyAll();
      toast(r.words);
      void load();
    } catch (e) {
      showError(e);
    } finally {
      setBusy('');
    }
  };
  const prepareAgain = async () => {
    setBusy('prepare');
    try {
      await window.nv.tidy.prepare();
      void load();
    } catch (e) {
      showError(e);
    } finally {
      setBusy('');
    }
  };

  const lines = proposal?.lines ?? [];
  const waiting = lines.filter((l) => l.status === 'waiting' || l.status === 'failed');
  const decided = lines.filter((l) => l.status !== 'waiting' && l.status !== 'failed');
  return (
    <>
      <ViewHeader tab={tab} crumb={<b>Weekly tidy</b>}>
        {/* The header contract (Round 2, 4 Nov 2026, the reviewer: nothing may ever overlap the centred
            search): Apply all yields into the ⋯ beside it when measured within 12px of the bar. */}
        {waiting.length > 0 && (
          <button type="button" className="btn" data-overflow="apply-all" data-overflow-order={1} disabled={!canEdit || !!busy} onClick={() => void applyAll()}>
            Apply all
          </button>
        )}
        <button type="button" className="navbtn topbar-tight-only" data-overflow-fallback="" aria-label="More for the weekly tidy" title="More" onClick={(e) => openMenu(e.currentTarget, overflowMenuItems(headerOverflowHidden(tab.id), {
          'apply-all': () => ({ label: 'Apply all', icon: 'sparkle', disabled: !canEdit || !!busy, run: () => void applyAll() }),
        }))}>
          <Icon name="more" size={16} />
        </button>
      </ViewHeader>
      <div className="nv-page-scroll tidy-page">
        <div className="nv-page">
          <h1 className="w4a-title">Weekly tidy</h1>
          {proposal === undefined ? (
            <p className="vsub">Looking over your notes…</p>
          ) : error ? (
            <EmptyState icon="sparkle" title="The tidy would not load" line={error} action={{ label: 'Try again', run: () => void load() }} />
          ) : !proposal ? (
            <EmptyState icon="sparkle" title="No notes open" line="Open a folder of notes first. The tidy looks over the notes you have open." />
          ) : (
            <>
              <p className="vsub">
                Prepared {whenPrepared(proposal.preparedAt)}. Nothing is deleted for good, and every applied fix can be undone.{' '}
                <button type="button" className="tidy-link" disabled={!canEdit || !!busy} onClick={() => void prepareAgain()}>
                  Look again
                </button>
              </p>
              {!lines.length ? (
                <EmptyState icon="sparkle" title="Everything is tidy" line="No duplicates, broken links, empty or thin notes, misplaced notes or stale reminders this week." />
              ) : !waiting.length ? (
                <EmptyState icon="check" title="This week is done" line="Every line is applied or skipped. Next week's tidy prepares itself." />
              ) : (
                <ul className="tidy-list">
                  {waiting.map((l) => (
                    <li key={l.id} className="tidy-line">
                      <div className="tidy-line-text">
                        <span className="tidy-kind">{KIND_WORDS[l.kind]}</span>
                        <span className="tidy-title">{l.title}</span>
                        <span className="tidy-detail">{l.detail}</span>
                        {!!l.paths.length && (
                          <button type="button" className="tidy-link" onClick={() => A.openPath(l.paths[0], { where: 'tab' })}>
                            Open {shortName(l.paths[0])}
                          </button>
                        )}
                        {l.status === 'failed' && l.words && <span className="tidy-failed">{l.words}</span>}
                      </div>
                      <div className="tidy-line-actions">
                        <button type="button" className="button primary" disabled={!canEdit || !!busy} onClick={() => void apply(l)}>
                          {busy === l.id ? 'Applying…' : tidyApplyWords(l.action)}
                        </button>
                        <button type="button" className="button" disabled={!canEdit || !!busy} onClick={() => void skip(l)}>
                          Skip
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {!!decided.length && (
                <div className="tidy-decided">
                  <h2 className="tidy-decided-title">Decided this week</h2>
                  <ul className="tidy-list is-decided">
                    {decided.map((l) => (
                      <li key={l.id} className="tidy-line">
                        <div className="tidy-line-text">
                          <span className="tidy-title">{l.title}</span>
                          <span className="tidy-detail">
                            {l.status === 'applied' ? 'Applied.' : l.status === 'undone' ? 'Applied, then undone.' : 'Skipped for now.'}
                          </span>
                        </div>
                        <div className="tidy-line-actions">
                          {l.status === 'applied' && (
                            <button type="button" className="button" disabled={!canEdit || !!busy} onClick={() => void undo(l.id)}>
                              <Icon name="undo" size={13} /> Undo
                            </button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
