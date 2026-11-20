// Shared spaces at a glance (10.0 item 26, 2 Nov 2026): every folder a household bot looks after, with how much
// is open in each. One row opens its home (SharedSpacePage), which reads like a project page. Spaces are made in
// the former host app, where the bot lives; when none is shared yet the page says so and where to make one.

import { useCallback, useEffect, useState } from 'react';
import type { SharedSpaceListItem } from '../../../shared/shared-space';
import { EmptyState, LoadingRows } from '../components/EmptyState';
import { Icon } from '../components/Icon';
import { hashTint } from '../lib/projectLook';
import * as A from '../state/actions';
import { showError, useApp } from '../state/store';
import type * as W from '../state/workspace';
import { ViewHeader } from './ViewHeader';

function counts(s: SharedSpaceListItem): string {
  if (!s.open) return 'Nothing open';
  const bits = [s.open === 1 ? '1 open' : `${s.open} open`];
  if (s.overdue) bits.push(s.overdue === 1 ? '1 late' : `${s.overdue} late`);
  else if (s.dueToday) bits.push(s.dueToday === 1 ? '1 due today' : `${s.dueToday} due today`);
  return bits.join(' · ');
}

export function SharedSpacesHome({ tab }: { tab: W.TabState }) {
  const revision = useApp((s) => s.revision);
  const [items, setItems] = useState<SharedSpaceListItem[] | null>(null);
  const load = useCallback(() => void window.nv.sharedSpaces.list().then(setItems, showError), []);
  useEffect(() => {
    const t = window.setTimeout(load, items ? 150 : 0);
    return () => window.clearTimeout(t);
  }, [revision, load]);

  return (
    <>
      <ViewHeader tab={tab} title="Shared spaces" />
      <div className="vscroll">
        {/* The frame sets the column (p25 one column; was: 980 here, its own left edge). */}
        <div className="vpage wide">
          <div className="w2a-head">
            <h1 className="w2a-title">Shared spaces</h1>
            {items && items.length > 0 && <span className="nv-page-count">{items.length === 1 ? '1 space' : `${items.length} spaces`}</span>}
          </div>
          {items === null ? (
            <LoadingRows rows={4} className="is-page" label="Reading your shared spaces" />
          ) : items.length === 0 ? (
            <EmptyState icon="people" title="No shared spaces yet" line="When one of your bots looks after a shared space, it shows here." />
          ) : (
            <div className="card" style={{ padding: '8px 20px', marginTop: 14 }}>
              {items.map((s) => (
                <button key={s.folder} className="trow w2a-rowbtn" onClick={() => A.openSharedSpace(s.folder)} title={`Open ${s.name}`}>
                  <span className={`gtile xs ${hashTint(s.folder)}`} aria-hidden="true">
                    <Icon name="people" size={14} />
                  </span>
                  <span style={{ display: 'block', flex: 1, minWidth: 0 }}>
                    <span className="t" style={{ display: 'block' }}>{s.name}</span>
                    <span className="meta" style={{ display: 'block' }}>Looked after by {s.bot} · {s.folder}</span>
                  </span>
                  <span className="meta" style={{ marginLeft: 'auto', flex: 'none' }}>{counts(s)}</span>
                  <Icon name="chevron" size={14} />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
