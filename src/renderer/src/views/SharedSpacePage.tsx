// One shared space's home (10.0 item 26, 2 Nov 2026): the folder reads like a project page, not a file list. The
// head names it with its key figures (how much is open, due, late); the sections are its dates, who owes what, its
// reminders and its notes. Ticks land in the notes through the Tasks view's own tick; every row opens where it lives.

import { useCallback, useEffect, useState } from 'react';
import { dueDayWords } from '../../../shared/hub';
import { dailyTitleWords } from '../../../shared/notes-list';
import { taskDueTag } from '../../../shared/projects-87';
import { showWords, type SpaceTask } from '../../../shared/shared-space';
import type { SharedSpaceHome } from '../../../main/shared-spaces';
import { EmptyState, LoadingRows } from '../components/EmptyState';
import { Icon } from '../components/Icon';
import { openMenu } from '../components/Menu';
import { headerOverflowHidden, overflowMenuItems } from '../lib/headerOverflow';
import * as A from '../state/actions';
import { peek } from '../state/peek';
import { showError, toast, useApp } from '../state/store';
import type * as W from '../state/workspace';
import { ViewHeader } from './ViewHeader';

// Whole words: toasts wrap (t207 pass 2).
const short = (s: string): string => s;

/** One open row, the Tasks view's own shape: a click peeks at it where it lives, Ctrl+click opens its note. */
function SpaceTaskRow({ t, today, canEdit, onTick }: { t: SpaceTask; today: string; canEdit: boolean; onTick(t: SpaceTask): void }) {
  const tag = taskDueTag(t.due, t.time, today, t.reminder);
  const words = showWords(t.words);
  const who = t.people.join(', ');
  const when = t.due ? `${dueDayWords(t.due, today)}${t.time ? ` ${t.time}` : ''}` : '';
  const where = dailyTitleWords(t.title) || t.title;
  // Plain words (5 Nov 2026, the plan); lateness needs no "due" in front of it.
  const said = when && (/late/i.test(when) || when === 'Yesterday') ? when : when ? `due ${when}` : '';
  const look = (e?: React.MouseEvent | React.KeyboardEvent): void => {
    if (e && (e.ctrlKey || e.metaKey)) return void A.openAtLine(t.path, t.line);
    peek({ type: 'action', path: t.path, line: t.line }, { title: words, type: 'action' });
  };
  return (
    <div className="trow tk-row" role="button" tabIndex={0} aria-label={`${words}${said ? `, ${said}` : ''}, in ${where}`} onClick={(e) => look(e)} onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); look(e); } }}>
      <button className="check" role="checkbox" aria-checked={false} aria-label={`Mark “${words}” done`} title="Done" disabled={!canEdit} onClick={(e) => (e.stopPropagation(), onTick(t))} onKeyDown={(e) => e.stopPropagation()}>
        {null}
      </button>
      <span className="t w2a-clip" title={words}>{words}</span>
      <span className="meta">{[who, where].filter(Boolean).join(' · ')}</span>
      {tag && <span className={`tag is-plain ${tag.tone === 'attention' ? 'is-attention' : 'is-muted'}`} style={{ marginLeft: 'auto' }}>{tag.words}</span>}
      {t.reminder && <span className={`tag slate${tag ? '' : ''}`} style={tag ? undefined : { marginLeft: 'auto' }}>Reminder</span>}
    </div>
  );
}

export function SharedSpacePage({ tab }: { tab: W.TabState }) {
  const revision = useApp((s) => s.revision);
  const canEdit = useApp((s) => s.canEdit);
  const folder = tab.path ?? '';
  const [home, setHome] = useState<SharedSpaceHome | 'gone' | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const load = useCallback(() => {
    setTicked(new Set());
    void window.nv.sharedSpaces.home(folder).then((h) => setHome(h ?? 'gone'), showError);
  }, [folder]);
  useEffect(() => {
    const t = window.setTimeout(load, home && home !== 'gone' ? 150 : 0);
    return () => window.clearTimeout(t);
  }, [revision, load]);

  const tick = (t: SpaceTask): void => {
    const key = `${t.path}#${t.line}`;
    setTicked((s) => new Set(s).add(key));
    void window.nv.tasks.tick(t.path, t.line, t.text, true).then(
      (r) => {
        toast(short(showWords(t.words)), {
          label: 'Undo',
          run: () => void window.nv.tasks.tick(t.path, t.line, r.line.replace(/^\s*(?:[-*+]|\d{1,9}[.)])\s+\[[^\]]\]\s+/, ''), false).then(load, showError),
        });
      },
      (e) => {
        setTicked((s) => {
          const next = new Set(s);
          next.delete(key);
          return next;
        });
        showError(e);
      },
    );
  };

  // The header contract (Round 2, 4 Nov 2026, the reviewer: nothing may ever overlap the centred search): All
  // spaces yields into the ⋯ beside it when measured within 12px of the bar, which only shows while carrying it.
  const head = (
    <ViewHeader tab={tab} title={home && home !== 'gone' ? home.name : 'Shared space'}>
      <button className="btn" data-overflow="all-spaces" data-overflow-order={1} title="Back to every shared space" onClick={() => A.openSharedSpaces()}>
        All spaces
      </button>
      <button type="button" className="navbtn topbar-tight-only" data-overflow-fallback="" aria-label="More for this shared space" title="More" onClick={(e) => openMenu(e.currentTarget, overflowMenuItems(headerOverflowHidden(tab.id), {
        'all-spaces': () => ({ label: 'All spaces', icon: 'people', run: () => A.openSharedSpaces() }),
      }))}>
        <Icon name="more" size={16} />
      </button>
    </ViewHeader>
  );
  if (!home)
    return (
      <>
        {head}
        <div className="vscroll">
          <div className="vpage wide" style={{ maxWidth: 980 }}>
            <LoadingRows rows={6} className="is-page" label="Reading the shared space" />
          </div>
        </div>
      </>
    );
  if (home === 'gone')
    return (
      <>
        {head}
        <div className="vscroll">
          <div className="vpage wide" style={{ maxWidth: 980 }}>
            <EmptyState icon="people" title="No longer shared" line="This folder is no longer a shared space." action={{ label: 'All spaces', run: () => A.openSharedSpaces() }} />
          </div>
        </div>
      </>
    );
  const s = home.summary;
  const visible = (t: SpaceTask): boolean => !ticked.has(`${t.path}#${t.line}`);
  const dates = s.open.filter((t) => t.due && t.due <= home.today && visible(t));
  const openCount = s.open.filter(visible).length;
  const figures = [`${openCount} open`, s.counts.overdue ? `${s.counts.overdue} late` : '', s.counts.dueToday ? `${s.counts.dueToday} due today` : ''].filter(Boolean).join(' · ');
  return (
    <>
      {head}
      <div className="vscroll">
        <div className="vpage wide" style={{ maxWidth: 980 }}>
          <div className="w2a-head">
            <h1 className="w2a-title">{home.name}</h1>
            {openCount > 0 && <span className="pill slate">{openCount === 1 ? '1 open' : `${openCount} open`}</span>}
          </div>
          <p className="nv-page-lead">A shared space · looked after by {home.bot} · {figures}</p>
          <div className="card" style={{ padding: '8px 20px', marginTop: 14 }} aria-label="Dates">
            <div className="glabel" style={{ paddingTop: 8 }}>Dates</div>
            {dates.length === 0 && <p className="meta" style={{ padding: '6px 0 12px' }}>Nothing due.</p>}
            <div role="list" aria-label="Shared dates">
              {dates.map((t) => (
                <SpaceTaskRow key={`${t.path}#${t.line}`} t={t} today={home.today} canEdit={canEdit} onTick={tick} />
              ))}
            </div>
          </div>
          <div className="card" style={{ padding: '8px 20px', marginTop: 12 }} aria-label="Who owes what">
            <div className="glabel" style={{ paddingTop: 8 }}>Who owes what</div>
            {s.owes.every((o) => o.tasks.every((t) => !visible(t))) && s.everyone.every((t) => !visible(t)) && <p className="meta" style={{ padding: '6px 0 12px' }}>Nothing owed.</p>}
            <div role="list" aria-label="Who owes what">
              {s.owes.map((o) => {
                const tasks = o.tasks.filter(visible);
                if (!tasks.length) return null;
                return (
                  <div key={o.who} role="listitem">
                    <div className="glabel" style={{ paddingTop: 8 }}>{o.who} · {tasks.length === 1 ? '1 task' : `${tasks.length} tasks`}</div>
                    {tasks.map((t) => (
                      <SpaceTaskRow key={`${t.path}#${t.line}`} t={t} today={home.today} canEdit={canEdit} onTick={tick} />
                    ))}
                  </div>
                );
              })}
              {s.everyone.some(visible) && (
                <div role="listitem">
                  <div className="glabel" style={{ paddingTop: 8 }}>For everyone</div>
                  {s.everyone.filter(visible).map((t) => (
                    <SpaceTaskRow key={`${t.path}#${t.line}`} t={t} today={home.today} canEdit={canEdit} onTick={tick} />
                  ))}
                </div>
              )}
            </div>
          </div>
          {s.reminders.some(visible) && (
            <div className="card" style={{ padding: '8px 20px', marginTop: 12 }} aria-label="Reminders">
              <div className="glabel" style={{ paddingTop: 8 }}>Reminders</div>
              <div role="list" aria-label="Shared reminders">
                {s.reminders.filter(visible).map((t) => (
                  <SpaceTaskRow key={`${t.path}#${t.line}`} t={t} today={home.today} canEdit={canEdit} onTick={tick} />
                ))}
              </div>
            </div>
          )}
          <div className="card" style={{ padding: '8px 20px', marginTop: 12 }} aria-label="Notes">
            <div className="glabel" style={{ paddingTop: 8 }}>Notes · {s.notes.length}</div>
            {s.notes.length === 0 && <p className="meta" style={{ padding: '6px 0 12px' }}>No notes yet.</p>}
            {s.notes.map((n) => (
              <button key={n.path} className="trow w2a-rowbtn" onClick={() => A.openPath(n.path)} title={`Open ${n.title}`}>
                <Icon name="notes" size={14} />
                <span className="t">{n.title}</span>
                <span className="meta" style={{ marginLeft: 'auto' }}>{n.open === 1 ? '1 open' : `${n.open} open`}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
