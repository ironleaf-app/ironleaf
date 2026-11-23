// Weekly's 8.7 pages (30 Oct 2026): this week's update (weekly.html: each workstream, the history, the home card) and
// the draft from projects (weekly-draft.html: every line with its source). Every ability the old overview had lives
// here: the week started from last week, gathered from projects with Undo, flags moved on, lines and workstreams
// added and taken out, sent and exported as text, Word or PDF. A workstream's metrics, attachments and week-by-week
// history keep the previous layout. One primary button per screen.

import { useMemo, useState } from 'react';
import { weekTitle, type Flag, type WeeklyUpdate, type Workstream } from '../../../../../shared/weekly-updates';
import { openMenu } from '../../../components/Menu';
import { writeLink } from '../../../lib/links';
import * as A from '../../../state/actions';
import { docs } from '../../../state/docs';
import { openTour } from '../../../state/moduleFills';
import { openModule, partOfTab } from '../../../state/modules';
import { toast } from '../../../state/store';
import { useWork, workDid } from '../../../state/workModules';
import type * as W from '../../../state/workspace';
import { dayText } from '../work/WorkShell';
import { TextHost, call, canGatherWeek, edit, exportMenu, flagTone, gatherWeek, type Proj, type WeeklyView } from '../work/WeeklyPage';
import { plural } from '../life/parts';
import { FillsLine, HomeCard, MoreButton, PackHead, PackPage, PageProps, Section, trashRecord, useCanEdit, EDIT_DETAILS_LABEL, FULL_DETAILS_LABEL } from './W3b';
import { TAKE_OUT_BUTTON, takeOutAria } from '../../../lib/removeWords';
import { isEnterKey } from '../../../lib/enterKey';

const MOD = 'weekly';
const flagTint = (f: string) => (flagTone(f) === 'ok' ? 'green' : flagTone(f) === 'warn' ? 'amber' : flagTone(f) === 'bad' ? 'red' : 'slate') as 'slate' | 'green' | 'amber' | 'red' | 'blue';
const nextFlag = (f: string): Flag | '' => (f === 'On track' ? 'At risk' : f === 'At risk' ? 'Blocked' : f === 'Blocked' ? 'Done' : f === 'Done' ? '' : 'On track');
const sameLine = (a: string, b: string) => a.trim().toLowerCase().replace(/\s+/g, ' ') === b.trim().toLowerCase().replace(/\s+/g, ' ');

function WorkstreamRow({ u, w, index, canEdit }: { u: WeeklyUpdate; w: Workstream; index: number; canEdit: boolean }) {
  const [adding, setAdding] = useState<'progress' | 'next' | null>(null);
  const [text, setText] = useState('');
  const send = () => { const t = text.trim(); if (!t || !adding) return; setText(''); setAdding(null); void edit(u.path, { kind: 'add-item', section: index, list: adding, text: t }); };
  // Next only from next (W5-29): done work never reads as what is next.
  const first = w.next[0] ?? '';
  const doneFirst = !first && w.progress[0] ? w.progress[0] : '';
  const blocker = !w.none && w.blockers[0] ? w.blockers[0] : '';
  return (
    <div className="trow" style={{ alignItems: 'flex-start' }}>
      <button type="button" className={`tag ${flagTint(w.flag)}`} style={{ border: 0, cursor: canEdit ? 'pointer' : 'default', flex: 'none', marginTop: 2 }} title={canEdit ? 'Click to move it on' : w.flag || 'No flag'} onClick={() => canEdit && void edit(u.path, { kind: 'section', section: index, field: 'flag', value: nextFlag(w.flag) })}>
        {w.flag || 'No flag'}
      </button>
      <div style={{ minWidth: 0, flex: 1 }}>
        <button type="button" className="t clip" style={{ background: 'none', border: 0, cursor: 'pointer', font: 'inherit', textAlign: 'left', color: 'var(--text)', fontSize: 15, fontWeight: 600, padding: 0 }} onClick={() => openModule(MOD, `classic:week:${u.week}`)} title={EDIT_DETAILS_LABEL}>{w.name}</button>
        <div className="meta" style={{ whiteSpace: 'normal' }}>
          {[w.status, first && `next: ${first}`, doneFirst && `done: ${doneFirst}`, blocker && `blocker: ${blocker}`].filter(Boolean).join(' · ') || 'Nothing written yet.'}
        </div>
        {adding && canEdit && (
          <span style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <input className="input" style={{ height: 32, flex: 1 }} value={text} placeholder={adding === 'progress' ? 'What moved' : 'What is next'} aria-label={adding === 'progress' ? 'What moved' : 'What is next'} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} autoFocus />
            <button type="button" className="btn" style={{ height: 32 }} disabled={!text.trim()} onClick={send}>Add</button>
          </span>
        )}
      </div>
      {canEdit && (
        <span style={{ display: 'flex', gap: 2, flex: 'none' }}>
          <button type="button" className="btn quiet" style={{ height: 28 }} title="Add what moved" onClick={() => setAdding('progress')}>+ Moved</button>
          <button type="button" className="btn quiet" style={{ height: 28 }} title="Add what is next" onClick={() => setAdding('next')}>+ Next</button>
          <button type="button" className="btn quiet" style={{ height: 28 }} aria-label={takeOutAria(w.name, 'this week')} title={takeOutAria(w.name, 'this week')} onClick={() => void edit(u.path, { kind: 'remove-section', section: index })}>{TAKE_OUT_BUTTON}</button>
        </span>
      )}
    </div>
  );
}

/** A draft ready to send (9.2 uplift F47): workstreams on the page, every one with lines, never "ready"
 *  for a week with zero sections. */
export function draftReady(u: WeeklyUpdate): boolean {
  const filled = (s: Workstream): boolean => s.progress.length > 0 || s.next.length > 0 || s.blockers.length > 0 || s.metrics.length > 0;
  return u.sections.length > 0 && u.sections.every(filled);
}

export function WeeklyOverview({ tab }: { tab: W.TabState }) {
  void tab;
  const canEdit = useCanEdit();
  const { data: view, error } = useWork<WeeklyView>(MOD);
  const u = view?.current ?? null;
  const atRisk = u?.sections.filter((s) => s.flag === 'At risk' || s.flag === 'Blocked').length ?? 0;
  const lastSent = view?.updates.find((x) => x.status === 'Sent');
  const hasPrev = !!view?.updates.some((x) => x.week !== view.thisWeek);
  const hasProjects = (view?.projects.length ?? 0) > 0;
  const [sectionName, setSectionName] = useState('');
  // The module's own scope (p15, Nov 2026): the pack sheets' per-pack rules hang under it.
  return (
    <div className="wm-weekly">
    <PackPage label="Weekly">
      <PackHead glyph="◔" tint="blue" title={`Weekly, ${view ? weekTitle(view.thisWeek).replace('Week of ', 'week of ') : ''}`} lead={`One section per workstream.${hasPrev ? ' Started from last week.' : ''}${lastSent ? ` Last sent ${dayText(lastSent.sent || lastSent.week)}.` : ''}`}
        actions={<>{u && u.status !== 'Sent' && <button type="button" className="btn pri" disabled={!canEdit} onClick={() => void workDid(call<string>('mark-sent', u.path, {}))}>Send this week</button>}<MoreButton label="More for Weekly" onOpen={(el) => openMenu(el, [
          { label: 'Gather a first draft from your projects', icon: 'sparkle', disabled: !canEdit || !canGatherWeek(u), run: () => canGatherWeek(u) && void gatherWeek(u).then(() => openModule(MOD, 'draft')) },
          { label: 'Draft from projects', icon: 'notes', disabled: !u, run: () => openModule(MOD, 'draft') },
          ...(u ? exportMenu(u, view?.projects ?? []) : []),
          { label: 'Workstreams, week by week', icon: 'chart', run: () => openModule(MOD, 'workstreams') },
          { label: 'Show me around Weekly', icon: 'sparkle', run: () => openTour('weekly') },
          { separator: true },
          { label: FULL_DETAILS_LABEL, icon: 'history', run: () => openModule(MOD, 'classic') },
        ])} /></>} />
      {u && <PageProps facts={[{ k: 'Status', v: <span className={`pill ${u.status === 'Sent' ? 'green' : atRisk ? 'amber' : 'slate'}`}>{u.status}{atRisk ? ` · ${atRisk} at risk` : ''}</span> }]} />}
      {error && <p className="vsub">{error}</p>}
      {!view && !error && <p className="vsub">Reading this week…</p>}
      {view && !u && (
        <div className="card" style={{ marginTop: 14 }}>
          <p className="vsub">{(() => {
            const from: string[] = [];
            if (hasPrev) from.push('starts from last week’s');
            if (hasProjects) from.push('gathers its first draft from your projects');
            return from.length ? `This week’s update hasn’t started. It ${from.join(', or ')}.` : 'This week’s update hasn’t started.';
          })()}</p>
          <FillsLine id="weekly" />
          <p style={{ marginTop: 8, display: 'flex', gap: 8 }}>
            <button type="button" className="btn pri" disabled={!canEdit} onClick={() => void workDid(call<string>('create', view.thisWeek, { fromLast: true }), hasPrev ? 'Started this week’s update from last week.' : 'Started this week’s update.')}>Start this week</button>
          </p>
        </div>
      )}
      {u && (
        <Section label="This week" action={canEdit && canGatherWeek(u) ? <button type="button" className="btn quiet" onClick={() => void gatherWeek(u).then(() => openModule(MOD, 'draft'))}>Draft from projects</button> : undefined}>
          <div className="card" style={{ padding: '6px 20px' }}>
            {!u.sections.length && <p className="vsub" style={{ padding: '9px 0' }}>No workstreams yet. Add one per project or area, or gather a first draft from your projects.</p>}
            {u.sections.map((w, i) => <WorkstreamRow key={`${w.name}-${i}`} u={u} w={w} index={i} canEdit={canEdit} />)}
            {canEdit && (
              <span style={{ display: 'flex', gap: 6, padding: '9px 0' }}>
                <input className="input" style={{ height: 32, flex: 1 }} value={sectionName} placeholder="A new workstream…" aria-label="A new workstream" onChange={(e) => setSectionName(e.target.value)} onKeyDown={(e) => { if (isEnterKey(e) && sectionName.trim()) { const n = sectionName.trim(); setSectionName(''); void edit(u.path, { kind: 'add-section', name: n }); } }} />
                <button type="button" className="btn" style={{ height: 32 }} disabled={!sectionName.trim()} onClick={() => { const n = sectionName.trim(); setSectionName(''); void edit(u.path, { kind: 'add-section', name: n }); }}>Add</button>
              </span>
            )}
          </div>
        </Section>
      )}
      {view && view.updates.filter((x) => x.week !== view.thisWeek).length > 0 && (
        <Section label="History">
          <div className="card" style={{ padding: '6px 20px' }}>
            {view.updates.filter((x) => x.week !== view.thisWeek).slice(0, 5).map((x) => (
              <div key={x.path} className="trow">
                <button type="button" className="t" style={{ background: 'none', border: 0, cursor: 'pointer', font: 'inherit', textAlign: 'left', color: 'var(--text)', fontSize: 15 }} onClick={() => openModule(MOD, `classic:week:${x.week}`)} title="Open it with every detail">{weekTitle(x.week)}</button>
                <span className="meta" style={{ marginLeft: 'auto' }}>{x.status === 'Sent' ? `sent ${dayText(x.sent || x.week)}` : 'draft'} · {x.sections.length} workstreams</span>
                {canEdit && <button type="button" className="btn quiet" aria-label={`Delete ${weekTitle(x.week)} to the Bin`} onClick={() => void trashRecord(x.path)}>Delete</button>}
              </div>
            ))}
          </div>
        </Section>
      )}
      {u && u.status !== 'Sent' && draftReady(u) && <HomeCard pack="Weekly update due" glyph="◔" tint="amber" title="Draft ready: send it before the week ends" meta="text, Word or PDF" />}
      <TextHost />
    </PackPage>
    </div>
  );
}

// ── The draft from projects ──────────────────────────────────────────────────────────────────────────────────────────

export function WeeklyDraft({ tab }: { tab: W.TabState }) {
  void tab;
  const canEdit = useCanEdit();
  const { data: view } = useWork<WeeklyView>(MOD);
  const [undoText, setUndoText] = useState<string | null>(null);
  const u = view?.current ?? null;
  const sources = useMemo(() => {
    if (!u || !view) return [] as { n: number; project: Proj; lines: number }[];
    const out: { n: number; project: Proj; lines: number }[] = [];
    for (const p of view.projects) {
      const pool = [...(p.updates ?? []), ...p.next, ...(p.risks ?? [])];
      let lines = 0;
      for (const s of u.sections) for (const line of [...s.progress, ...s.next, ...s.blockers]) if (pool.some((x) => sameLine(x, line))) lines++;
      if (lines) out.push({ n: out.length + 1, project: p, lines });
    }
    return out;
  }, [u, view]);
  const citesOf = (lines: string[]): number[] => {
    if (!view) return [];
    const out: number[] = [];
    for (const s of sources) {
      const pool = [...(s.project.updates ?? []), ...s.project.next, ...(s.project.risks ?? [])];
      if (lines.some((line) => pool.some((x) => sameLine(x, line))) && !out.includes(s.n)) out.push(s.n);
    }
    return out;
  };
  const gather = () => {
    if (!canGatherWeek(u) || !canEdit) return;
    void gatherWeek(u, setUndoText);
  };
  const undo = async () => {
    if (!u || undoText === null) return;
    // The open tab's words land first (Nov 2026, nv-save F12), so the undo never strands them.
    await docs.flush(u.path);
    await window.nv.notes.write(u.path, undoText);
    setUndoText(null);
    await workDid(Promise.resolve('The draft is undone.'));
  };
  if (!view) return <div className="wm-weekly"><PackPage label="Weekly"><p className="vsub">Reading this week…</p></PackPage></div>;
  if (!u) return <div className="wm-weekly"><PackPage label="Weekly"><div className="card" style={{ marginTop: 14 }}><p className="vsub">This week’s update hasn’t started, so there is no draft yet.</p><p style={{ marginTop: 8 }}><button type="button" className="btn" onClick={() => openModule(MOD)}>Weekly</button></p></div></PackPage></div>;
  const copyLink = () => { void navigator.clipboard.writeText(writeLink(u.path, undefined)).then(() => toast('A link to the draft is on the clipboard.')); };
  return (
    <div className="wm-weekly">
    <PackPage label="Draft from projects">
      <PackHead glyph="◔" tint="blue" title="Draft from projects" lead={`Drafted from ${plural(sources.length || view.projects.length, 'project note')}. Every line shows its source.`}
        actions={<><button type="button" className="btn pri" onClick={(e) => openMenu(e.currentTarget, exportMenu(u, view.projects))}>Send as…</button><MoreButton label="More for the draft" onOpen={(el) => openMenu(el, [
          { label: 'Gather again', icon: 'sparkle', disabled: !canEdit, run: () => void gather() },
          ...(undoText !== null ? [{ label: 'Undo this draft', icon: 'history' as const, disabled: !canEdit, run: () => void undo() }] : []),
          { label: 'Mark sent', icon: 'check', disabled: !canEdit || u.status === 'Sent', run: () => void workDid(call<string>('mark-sent', u.path, {})) },
          { label: 'Copy link', icon: 'link', run: copyLink },
          { label: EDIT_DETAILS_LABEL, icon: 'table', run: () => openModule(MOD, `classic:week:${u.week}`) },
        ])} /></>} />
      <div className="callout blue" style={{ marginTop: 14 }}>
        <span aria-hidden="true">✎</span>
        <span><b>Drafted from your projects.</b> Check each section, edit where it sits.</span>
        {undoText !== null && canEdit && <button type="button" className="btn" style={{ marginLeft: 'auto', flex: 'none' }} onClick={() => void undo()}>Undo this draft</button>}
      </div>
      <Section label={`Draft · ${weekTitle(u.week)}`}>
        <div className="card w3b-draft">
          {!u.sections.length && <p className="vsub">Nothing gathered yet.</p>}
          {u.sections.map((s, i) => (
            <p key={`${s.name}-${i}`}>
              <strong>{s.name}</strong>, {s.flag ? `${s.flag.toLowerCase()}, ` : ''}{[s.status, ...s.progress, ...s.next.map((x) => `next: ${x}`), ...(!s.none ? s.blockers : [])].filter(Boolean).join('. ') || 'nothing yet'}.
              {citesOf([...s.progress, ...s.next, ...s.blockers]).map((n) => {
                const src = sources.find((x) => x.n === n)!;
                return <button key={n} type="button" className="cite" style={{ border: 0, cursor: 'pointer', font: 'inherit' }} title={`${src.project.name}: open its note`} onClick={() => A.openPath(src.project.path)}>{n}</button>;
              })}
              {canEdit && <button type="button" className="btn quiet" style={{ height: 26, marginLeft: 8 }} onClick={() => openModule(MOD, `classic:week:${u.week}`)} title="Edit this section with every detail">Edit</button>}
            </p>
          ))}
        </div>
      </Section>
      {!!sources.length && (
        <Section label="Sources">
          <div className="card" style={{ padding: '6px 20px' }}>
            {sources.map((s) => (
              <div key={s.n} className="w3b-src">
                <span className="cite">{s.n}</span>
                <button type="button" className="t clip" style={{ background: 'none', border: 0, cursor: 'pointer', font: 'inherit', textAlign: 'left', color: 'var(--text)', fontSize: 14 }} onClick={() => A.openPath(s.project.path)}>{s.project.name}</button>
                <span className="n" style={{ marginLeft: 'auto' }}>{s.lines} {s.lines === 1 ? 'line' : 'lines'}</span>
              </div>
            ))}
          </div>
        </Section>
      )}
      {!sources.length && <div className="card" style={{ marginTop: 14 }}><p className="vsub">No line matches a project’s words yet. Gather a first draft and each line shows its source.</p><p style={{ marginTop: 8 }}><button type="button" className="btn" disabled={!canEdit} onClick={() => void gather()}>Gather a first draft</button></p></div>}
      <TextHost />
    </PackPage>
    </div>
  );
}

/** Weekly's page switch: the new update and draft, the previous layout, the rest as before. */
export function weeklyPlace(tab: W.TabState): 'overview' | 'draft' | 'classic' | 'rest' {
  const part = partOfTab(tab) ?? 'overview';
  if (part === 'classic' || part.startsWith('classic:')) return 'classic';
  if (part === 'draft') return 'draft';
  if (part === 'overview' || part === '') return 'overview';
  return 'rest';
}
