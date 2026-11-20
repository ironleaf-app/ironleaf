// The weekly review (src/shared/weekly-review.ts): the week across every project, drafted from the project files — what
// changed, what slipped, what to chase — and the changes to make, each ticked, changed or left; applied in one pass
// ("Apply 7 changes"), with a "Weekly review — 17 Oct 2026" note saved in Reviews. Opened from the Projects home, the
// command list ("Start weekly review") and the Friday notice.

import { aiReadyOrSay } from '../components/AiSetup';
import { useEffect, useMemo, useState } from 'react';
import { dayWords, readDay } from '../../../shared/days';
import { HEALTHS } from '../../../shared/project-file';
import type { ProjectReview, ReviewDraft, ReviewItem, ReviewProposal } from '../../../shared/weekly-review';
import { tidyKindCountWords } from '../../../shared/weekly-tidy';
import { plural } from '../../../shared/words';
import type { TidyStatus } from '../../../main/weekly-tidy';
import { Icon, type IconName } from '../components/Icon';
import { errorMessage } from '../lib/errors';
import { EmptyState } from '../components/EmptyState';
import { PageHead } from '../components/PageHead';
import { healthTone, whenAgo } from '../lib/projectLook';
import * as A from '../state/actions';
import { refreshReviewStanding } from '../state/reviews';
import { showError, toast, useApp } from '../state/store';
import { EditorContext, Inline, InlineDate } from './project/Inline';
import { TidyAllDialog } from './project/TidyDialog';
import { Pill } from './ProjectPage';

const cap = (s?: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
// One plural rule everywhere (3 Nov 2026, fourth-round G5-G7): imported from shared/words above.
const fromDay = (iso: string) => readDay(iso) ?? new Date();

type Done = { words: string; note: string; id: string; changes: number };

function ItemList({ title, icon, tone, items, left, onLeave, onOpen }: { title: string; icon: IconName; tone: string; items: ReviewItem[]; left: Set<string>; onLeave(id: string): void; onOpen(i: ReviewItem): void }) {
  if (!items.length) return null;
  return (
    <div className={`wr-block tone-${tone}`}>
      <h3>
        <Icon name={icon} size={13} /> {title}
        <span className="wr-count">{items.filter((i) => !left.has(i.id)).length}</span>
      </h3>
      <ul>
        {items.map((i) => (
          <li key={i.id} className={`wr-item${left.has(i.id) ? ' left' : ''}${i.open ? ' opens' : ''}`}>
            <span className="wr-dot" />
            <span className="wr-item-words" role={i.open ? 'button' : undefined} tabIndex={i.open ? 0 : undefined} onClick={() => i.open && onOpen(i)} onKeyDown={(e) => e.key === 'Enter' && i.open && onOpen(i)}>
              <span>{i.words}</span>
              {i.detail && <span className="wr-detail">{i.detail}</span>}
            </span>
            <button className="wr-leave" title={left.has(i.id) ? 'Keep it in the review’s note' : 'Leave it out of the review’s note'} aria-label={left.has(i.id) ? 'Keep' : 'Leave out'} onClick={() => onLeave(i.id)}>
              <Icon name={left.has(i.id) ? 'undo' : 'close'} size={12} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ProposalRow({ x, health, onChange }: { x: ReviewProposal; health?: string; onChange(next: Partial<ReviewProposal>): void }) {
  return (
    <li className={`wr-prop${x.accept ? ' on' : ''}${x.by === 'assistant' ? ' by-ai' : ''}`}>
      <input type="checkbox" checked={x.accept} onChange={() => onChange({ accept: !x.accept })} aria-label={x.words} />
      <div className="wr-prop-body">
        {x.kind === 'health' ? (
          <div className="wr-prop-line">
            <span>Health</span>
            <Pill tone={healthTone(health)}>{cap(health) || 'Not set'}</Pill>
            <Icon name="forward" size={12} className="wr-arrow" />
            <span className="wr-choices" role="radiogroup" aria-label="New health">
              {HEALTHS.map((h) => (
                <button key={h} role="radio" aria-checked={x.value === h} className={`pj-pill tone-${healthTone(h)}${x.value === h ? ' chosen' : ''}`} onClick={() => onChange({ value: h, accept: true, words: `Health: ${cap(health) || 'not set'} → ${cap(h)}` })}>
                  {cap(h)}
                </button>
              ))}
            </span>
          </div>
        ) : x.kind === 'move' ? (
          <div className="wr-prop-line">
            <span>
              Move <strong>{x.step}</strong> to
            </span>
            <InlineDate value={x.value} label="New day" className="pj-chip" clearable={false} onSave={(v) => onChange({ value: v.replace(/ \d{4}$/, (y) => (Number(y) === new Date().getFullYear() ? '' : y)), accept: true })}>
              {x.value}
            </InlineDate>
          </div>
        ) : x.kind === 'update' ? (
          <div className="wr-prop-update">
            <span className="wr-prop-label">{x.by === 'assistant' ? 'Add an update' : 'Add this week’s update'}</span>
            <Inline value={x.value} required multiline label="Update" className="wr-update-words" onSave={(v) => onChange({ value: v, accept: true })} />
          </div>
        ) : x.kind === 'next' ? (
          <div className="wr-prop-update">
            <span className="wr-prop-label">New next step</span>
            <Inline value={x.value} required label="Next step" className="wr-update-words" onSave={(v) => onChange({ value: v, accept: true, words: `New next step: ${v}` })} />
          </div>
        ) : (
          <div className="wr-prop-line">{x.words}</div>
        )}
        {(x.why || x.by === 'assistant') && (
          <div className="wr-why">
            {x.by === 'assistant' && (
              <span className="wr-ai">
                <Icon name="sparkle" size={11} /> Assistant
              </span>
            )}
            {x.why}
          </div>
        )}
      </div>
    </li>
  );
}

function ProjectBlock({ r, left, onLeave, onProposal }: { r: ProjectReview; left: Set<string>; onLeave(id: string): void; onProposal(id: string, next: Partial<ReviewProposal>): void }) {
  const tone = healthTone(r.health);
  // Opening from the review (t239): the document itself, where the person is — a file in the full viewer.
  const open = (i: ReviewItem) => {
    if (!i.open) return;
    if ('note' in i.open) A.openPath(i.open.note);
    else A.openFolderFile(r.path, i.open.file);
  };
  return (
    <article className={`wr-project tone-${tone}`}>
      <header className="wr-project-head">
        <button className="wr-project-name" onClick={(e) => A.openPath(r.path, { where: e.ctrlKey || e.metaKey ? 'tab' : 'current' })} title="Open the project">
          {r.name}
        </button>
        <Pill tone={tone}>{r.health ? cap(r.health) : 'No health yet'}</Pill>
        {r.status && <span className="wr-status">{cap(r.status)}</span>}
        <span className="wr-space" />
        {r.since === 'none' && <span className="wr-since" title="Ironleaf had no copy of this project from the start of the week, so changes are taken from dated lines, notes and files only.">From dated lines and files</span>}
      </header>
      <div className="wr-columns">
        <ItemList title="What changed" icon="check" tone="ok" items={r.changed} left={left} onLeave={onLeave} onOpen={open} />
        <ItemList title="What slipped" icon="warning" tone="bad" items={r.slipped} left={left} onLeave={onLeave} onOpen={open} />
        <ItemList title="To chase" icon="people" tone="warn" items={r.chase} left={left} onLeave={onLeave} onOpen={open} />
      </div>
      {r.proposals.length > 0 && (
        <div className="wr-props">
          <h3>Changes to make</h3>
          <ul>
            {r.proposals.map((x) => (
              <ProposalRow key={x.id} x={x} health={r.health} onChange={(next) => onProposal(x.id, next)} />
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}

export function WeeklyReview() {
  const canEdit = useApp((s) => s.canEdit);
  const [draft, setDraft] = useState<(ReviewDraft & { last: number | null }) | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [left, setLeft] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<'apply' | 'look' | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  // Tidy lives here now (8 Nov 2026, calm list: not for today): projects with finished work to move
  // to their History notes, or the weekly tidy ready. One row, one click, as it was on Today.
  const [tidyCount, setTidyCount] = useState(0);
  const [tidyOpen, setTidyOpen] = useState(false);
  const [weeklyTidy, setWeeklyTidy] = useState<TidyStatus | null>(null);
  useEffect(() => {
    let live = true;
    void window.nv.projects.tidyAllPreview().then((rows) => live && setTidyCount(rows.length), () => undefined);
    void window.nv.tidy.status().then((s) => live && setWeeklyTidy(s), () => undefined);
    const off = window.nv.on.tidyChanged((s) => live && setWeeklyTidy(s));
    return () => {
      live = false;
      off();
    };
  }, []);
  const tidyWaitingWords = weeklyTidy && weeklyTidy.waiting > 0 ? `The weekly tidy is ready: ${tidyKindCountWords(weeklyTidy.byKind)}` : null;
  const tidyRow = (tidyCount > 0 || tidyWaitingWords) && (
    <button type="button" className="wr-tidy" onClick={() => (tidyCount > 0 ? setTidyOpen(true) : A.openTidy())} title={tidyCount > 0 ? 'Tidy finished work into History notes' : 'Open the weekly tidy'}>
      <Icon name="sparkle" size={13} />
      <span>{tidyCount > 0 ? `${tidyCount} ${tidyCount === 1 ? 'project' : 'projects'} ready to tidy` : tidyWaitingWords}</span>
      <Icon name="forward" size={12} />
    </button>
  );

  const load = () => {
    setFailed(null);
    setDraft(null);
    setDone(null);
    setLeft(new Set());
    setSaid(null);
    window.nv.reviews.draft().then(setDraft, (err) => setFailed(errorMessage(err)));
  };
  useEffect(load, []);

  const counts = useMemo(() => {
    const ps = draft?.projects ?? [];
    const all = ps.flatMap((p) => p.proposals);
    return {
      moved: ps.filter((p) => p.changed.length).length,
      slipped: ps.reduce((n, p) => n + p.slipped.length, 0),
      chase: ps.reduce((n, p) => n + p.chase.length, 0),
      proposed: all.length,
      chosen: all.filter((x) => x.accept).length,
    };
  }, [draft]);

  const setProposal = (path: string, id: string, next: Partial<ReviewProposal>) =>
    setDraft((d) => (d ? { ...d, projects: d.projects.map((p) => (p.path === path ? { ...p, proposals: p.proposals.map((x) => (x.id === id ? { ...x, ...next } : x)) } : p)) } : d));
  const leave = (id: string) =>
    setLeft((was) => {
      const next = new Set(was);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  /** The draft as it goes to be applied: items left out taken off. */
  const outgoing = (d: ReviewDraft): ReviewDraft => ({ from: d.from, to: d.to, title: d.title, projects: d.projects.map((p) => ({ ...p, changed: p.changed.filter((i) => !left.has(i.id)), slipped: p.slipped.filter((i) => !left.has(i.id)), chase: p.chase.filter((i) => !left.has(i.id)) })) });

  const apply = async () => {
    if (!draft || busy) return;
    setBusy('apply');
    try {
      const r = await window.nv.reviews.apply(outgoing(draft));
      setDone({ words: r.words, note: r.note, id: r.id, changes: r.changes });
      void refreshReviewStanding();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(null);
    }
  };
  const lookOver = async () => {
    if (!draft || busy) return;
    if (!aiReadyOrSay()) return;
    setBusy('look');
    setSaid(null);
    try {
      const r = await window.nv.reviews.lookOver(draft);
      if (r.error) setSaid(r.error);
      else {
        setDraft({ ...r.draft, last: draft.last });
        setSaid(r.added ? `The assistant suggested ${plural(r.added, 'change')}: each is marked, and off until you tick it.` : 'The assistant had nothing to add.');
      }
    } catch (err) {
      showError(err);
    } finally {
      setBusy(null);
    }
  };
  const undo = async () => {
    if (!done) return;
    try {
      toast(await window.nv.reviews.undo(done.id));
      void refreshReviewStanding();
      load();
    } catch (err) {
      showError(err);
    }
  };

  const editor = { path: '', canEdit, known: { people: [], tags: [] }, edit: async () => true };
  const active = draft?.projects.filter((p) => !p.quiet) ?? [];
  const quiet = draft?.projects.filter((p) => p.quiet) ?? [];
  const from = draft ? fromDay(draft.from) : null;
  const to = draft ? fromDay(draft.to) : null;

  return (
    <EditorContext.Provider value={editor}>
      <div className="pj-page wr-page">
        <div className="pj-inner">
          {/* One page header for every page (8.0 section D): PageHead. */}
          <PageHead icon="review" title="Weekly review" lead={draft && from && to && draft.projects.length > 0 ? <>
                  <span>
                    {dayWords(from)} – {dayWords(to)}
                  </span>
                  {counts.moved > 0 && <span className="tone-ok">{plural(counts.moved, 'project')} moved</span>}
                  {counts.slipped > 0 && <span className="tone-bad">{counts.slipped} slipped</span>}
                  {counts.chase > 0 && <span className="tone-warn">{counts.chase} to chase</span>}
                  <span>{draft.last ? `Last review ${whenAgo(draft.last)}` : 'Your first review'}</span>
                </> : undefined} actions={draft && !done && draft.projects.length > 0 ? (
                <button className="button" disabled={!!busy || !canEdit} onClick={() => void lookOver()} title="The chat’s assistant reads the draft and the project files and suggests what it missed. Its suggestions stay off until you tick them.">
                  <Icon name="sparkle" size={14} /> {busy === 'look' ? 'Looking it over…' : 'Ask the assistant to look over it'}
                </button>
            ) : undefined} />
          <p className="wr-said">This review goes over your projects: what changed, what slipped and what to chase. It is not the Weekly you send out (Weekly Updates), or the weekly review in Goals.</p>
          {said && <p className="wr-said">{said}</p>}
          {tidyRow}

          {failed ? (
            <div className="pj-welcome">
              <Icon name="warning" size={24} />
              <h2>The review couldn’t be drafted</h2>
              <p>{failed}</p>
              <button className="button" onClick={load}>
                Try again
              </button>
            </div>
          ) : !draft ? (
            <div className="wr-loading">
              <span className="wr-spinner" />
              Going over the week in every project…
            </div>
          ) : done ? (
            <div className="wr-done">
              <span className="wr-done-icon">
                <Icon name="check" size={20} />
              </span>
              <h2>Review done</h2>
              <p>{done.words}</p>
              <div className="pj-actions">
                <button className="button primary" onClick={() => A.openPath(done.note, { where: 'current' })}>
                  <Icon name="file" size={14} /> Open the review’s note
                </button>
                <button className="button" onClick={() => A.openProjects()}>
                  <Icon name="layers" size={14} /> Projects
                </button>
                <button className="button" onClick={() => void undo()}>
                  <Icon name="undo" size={14} /> Undo
                </button>
              </div>
            </div>
          ) : draft.projects.length === 0 ? (
            <EmptyState
              icon="review"
              title="No projects to review yet"
              line="The weekly review goes over your projects: what changed, what slipped and what to chase."
              action={{ label: 'Set up your projects', icon: 'layers', run: () => A.openProjects() }}
            />
          ) : (
            <>
              {active.length === 0 && <p className="wr-said">Every project was quiet this week: nothing changed, slipped or waits on anyone.</p>}
              {active.map((r) => (
                <ProjectBlock key={r.path} r={r} left={left} onLeave={leave} onProposal={(id, next) => setProposal(r.path, id, next)} />
              ))}
              {quiet.length > 0 && (
                <div className="wr-quiet">
                  <span className="wr-quiet-label">Quiet this week</span>
                  {quiet.map((r) => (
                    <button key={r.path} className="wr-quiet-name" onClick={() => A.openPath(r.path, { where: 'current' })}>
                      <span className={`pj-dot tone-${healthTone(r.health)}`} />
                      {r.name}
                    </button>
                  ))}
                </div>
              )}
              <div className="wr-bar">
                <span className="wr-bar-words">
                  {counts.proposed ? `${counts.chosen} of ${plural(counts.proposed, 'change')} chosen` : 'No changes to make'} · the review’s note goes in Reviews
                </span>
                <button className="button primary large" disabled={!canEdit || busy === 'apply'} onClick={() => void apply()}>
                  {busy === 'apply' ? 'Applying…' : counts.chosen ? `Apply ${plural(counts.chosen, 'change')}` : 'Finish the review'}
                </button>
              </div>
            </>
          )}
        </div>
        {tidyOpen && (
          <TidyAllDialog
            onClose={() => setTidyOpen(false)}
            onTidied={(done) => {
              setTidyCount(0);
              toast(
                done.length === 1 ? done[0].words : `Tidied ${done.length} projects: what moved is in each project’s History note.`,
                done.length
                  ? {
                      label: 'Undo',
                      run: () =>
                        void (async () => {
                          for (const r of [...done].reverse()) await window.nv.projects.tidyUndo(r.view.path);
                        })().catch(showError),
                    }
                  : undefined,
              );
            }}
          />
        )}
      </div>
    </EditorContext.Provider>
  );
}
