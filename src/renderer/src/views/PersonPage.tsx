// A person's page (Job B, 29 Oct 2026, SPEC B; 8.7 w2b, 30 Oct 2026): who they are, what is between you, and one
// timeline of the meetings you share, the promises either way, their projects and the notes that name them. Their
// details change in their note; their note deletes to the Recycle Bin from here.
import { useEffect, useMemo, useState } from 'react';
import { spanWords } from '../../../shared/days';
import { TASK_LINE } from '../../../shared/markdown';
import { checkInDraft, nextMeetingWords, personRecordIdOfTab, personTimeline, type PersonAction, type PersonCard } from '../../../shared/people';
import { taskDueTag } from '../../../shared/projects-87';
import { WhenInner } from '../components/plan/TaskCells';
import { recordFactEdit, recordFactText } from '../../../shared/record-edits';
import { PageHead } from '../components/PageHead';
import { Icon } from '../components/Icon';
import { EmptyState } from '../components/EmptyState';
import { errorMessage } from '../lib/errors';
import { openMenu } from '../components/Menu';
import { initials, personHue, readDate, shortDate } from '../lib/projectLook';
import { saveNoteFact } from '../lib/noteFacts';
import * as A from '../state/actions';
import { askInChat, draftInChat } from '../state/chat';
import { docs } from '../state/docs';
import { setWorkspace } from '../state/layout';
import { peek } from '../state/peek';
import { showError, toast, useApp } from '../state/store';
import * as Ws from '../state/workspace';
import type * as W from '../state/workspace';
import { EditorContext, Inline } from './project/Inline';
import { PageTabs, TabFind, usePageTabs } from '../components/PageTabs';
import { PERSON_TABS, usePersonMemory, usePersonMemoryReady } from './personMemory';
import '../styles/people-meetings.css';
import '../styles/w2b.css';

function dayWords(iso?: string): string {
  if (!iso) return '';
  const ms = readDate(iso);
  return ms === null ? iso : shortDate(ms);
}

/** Tick one open action through the Tasks tick (one task, one row: its matching steps and lines tick with it,
 *  and the write lands in the note as every save does). */
async function tickAction(item: PersonAction, done: boolean): Promise<void> {
  const text = docs.text(item.path) ?? (await docs.acquire(item.path));
  const lines = text.split('\n');
  // The action's own line (9.2 uplift F36): its place with its whole title, else the whole title found, so
  // "Call Mum about birthday" and "Call Mum about dinner" tick apart, and "Call Mum" never flips either.
  const whole = (l: string) => {
    const body = l.replace(/^\s*(?:[-*+]|\d+[.)])\s+\[[^\]]\]\s+/, '').trim();
    // Owner tails in the person's own words (the em dash built from its code: this file keeps no raw em dash).
    const em = String.fromCharCode(8212);
    return body === item.title || body.startsWith(`${item.title} ${em} `) || body.startsWith(`${item.title} \u2013 `) || body.startsWith(`${item.title} \u00b7 `);
  };
  const at = item.line !== undefined && lines[item.line] !== undefined && whole(lines[item.line]) ? item.line : lines.findIndex(whole);
  if (at < 0) throw new Error('That action changed in its note just now. Open the note and tick it there.');
  const words = lines[at].replace(/^\s*(?:[-*+]|\d+[.)])\s+\[[^\]]\]\s+/, '');
  if (!TASK_LINE.test(lines[at])) throw new Error('That action is not a tick box in its note. Open the note to change it.');
  await window.nv.tasks.tick(item.path, at, words, done);
}

function ActionCard({ title, items, empty, today, limit, wrap }: { title: string; items: PersonAction[]; empty: string; today: string; limit?: number; wrap?: boolean }) {
  const canEdit = useApp((s) => s.canEdit);
  const [done, setDone] = useState<Set<string>>(new Set());
  // A fresh read replaces local ticks (p15-person, 4 Nov 2026): a tick put back in its note reads open again,
  // never stuck with a tick it no longer has.
  useEffect(() => { setDone(new Set()); }, [items]);
  // The Overview reads the head of each side (t255): the count stays the whole, an All link opens the tab.
  const shown = limit === undefined ? items : items.slice(0, limit);
  return (
    <div className="card w2b-half">
      <div className="glabel w2b-group">{title}{items.length > 0 ? ` · ${items.length}` : ''}</div>
      {items.length ? (
        // Two lines that open on their line (p15-person, 4 Nov 2026): halves give each title half the room,
        // so one line cut them far too early. The full words stay on hover. The Overview wraps whole instead
        // (t255): a narrow column must never cut words with dots.
        shown.map((x) => {
          const isDone = done.has(x.id);
          // The day in plain words, as every task row reads it (t208, 11 Nov 2026, second look at real
          // content: a filled Late block beside plain "5 days late" everywhere else): the Tasks page's own
          // words through the one reader, never a tag.
          const tag = x.date ? taskDueTag(x.date, null, today) : null;
          return (
            <div key={x.id} className="trow">
              <button type="button" className={`check${isDone ? ' done' : ''}`} disabled={!canEdit} aria-label={`Done: ${x.title}`} onClick={() => { const on = !isDone; void tickAction(x, on).then(() => setDone((s) => { const n = new Set(s); if (on) n.add(x.id); else n.delete(x.id); return n; })).catch(showError); }}>
                {isDone ? '✓' : null}
              </button>
              <button type="button" className={`w2b-link t${wrap ? '' : ' clip-2'}${isDone ? ' is-done' : ''}`} style={wrap ? { whiteSpace: 'normal', overflowWrap: 'break-word' } : undefined} onClick={() => A.openPath(x.path, { where: 'current', ...(x.line !== undefined ? { line: x.line } : {}) })} title={`${x.title} (open where it is written)`}>{x.title}</button>
              {tag && <span className="w2b-when"><WhenInner words={tag.words} tone={isDone || tag.tone !== 'attention' ? 'quiet' : 'coral'} /></span>}
            </div>
          );
        })
      ) : <p className="vsub">{empty}</p>}
    </div>
  );
}

export function PersonPage({ tab }: { tab: W.TabState }) {
  // The record id, healed: old tabs doubled the marker (`person:person:…`), new tabs carry it once.
  const id = personRecordIdOfTab(tab.path);
  const revision = useApp((s) => s.revision);
  const canEdit = useApp((s) => s.canEdit);
  const [card, setCard] = useState<PersonCard | null | undefined>(undefined);
  // A failed read is not "gone" (W5-6): it has its own state and Try again.
  const [failed, setFailed] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    void window.nv.life.people.card(id).then((c) => live && (setCard(c), setFailed('')), (e) => live && setFailed(errorMessage(e)));
    return () => { live = false; };
  }, [id, revision, attempt]);
  const today = useMemo(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }, []);
  // One timeline (10.0 papercuts): meetings, finished promises and notes, dated first and newest first. Projects
  // read in their own card below (t8, 8 Nov 2026, "everything feels connected"), and open promises read under
  // You owe / Owes you above (t12, 8 Nov 2026), so the timeline keeps meetings, finished promises and notes
  // only: nothing reads twice on the page.
  const timeline = useMemo(() => (card ? personTimeline(card).filter((e) => e.kind !== 'project') : []), [card]);
  // Only the head of the timeline is drawn (t102, 9 Nov 2026, as Tasks' hundred): a connected person has
  // hundreds of rows, and drawing them all kept the page. The rest waits behind the same Show more.
  const [timelineCount, setTimelineCount] = useState(50);
  useEffect(() => { setTimelineCount(50); }, [id]);
  // The kit's fields on their facts (role, organisation, email, phone change in place).
  const editor = useMemo(() => ({ path: '', canEdit, known: { people: [], tags: [] as string[] }, edit: async () => false }), [canEdit]);
  // The page's own tabs (t255): a connected person's page scrolled on and on, Overview first, then
  // Promises, Projects and Timeline through the one shared hook (history, memory, no reload). Before the
  // card loads the tabs stand uncounted; the branches below return before any tab reads them.
  const [memory, remember] = usePersonMemory(id);
  const memReady = usePersonMemoryReady();
  const tabDefs = useMemo(
    () =>
      PERSON_TABS.map((t) =>
        t.id === 'overview' || !card
          ? { id: t.id, title: t.title }
          : { id: t.id, title: t.title, count: t.id === 'promises' ? card.youOweItems.length + card.owesYouItems.length : t.id === 'projects' ? card.projects.length : timeline.length },
      ),
    [card, timeline],
  );
  const remembered = useMemo(() => (PERSON_TABS.some((t) => t.id === memory.section) ? memory.section : undefined), [memory.section]);
  const rememberTab = (tabId: string) => remember((m) => ({ ...m, section: tabId }));
  const { active, openTab, isMounted, focusSignal } = usePageTabs({ tabId: tab.id, pageKey: `person:${id}`, tabs: tabDefs, defaultTab: 'overview', section: tab.section, remembered, ready: memReady, remember: rememberTab });
  // The page scrolls in the frame's scroller, as its siblings do (a1, 6 Nov 2026: a long page overflowed
  // the pane with no scroller, its Timeline unreachable). Every branch brings the wrapper, as PeoplePage does.
  if (failed) return (<div className="nv-page-scroll"><div className="nv-page"><PageHead icon="person" title="Person" lead="Their card could not be read just now." /><EmptyState size="panel" icon="people" title="Couldn't check" line={failed} action={{ label: 'Try again', run: () => setAttempt((a) => a + 1) }} /></div></div>);
  if (card === undefined) return <div className="nv-page-scroll"><div className="nv-page"><div className="pc-loading" aria-busy="true" /></div></div>;
  if (!card) return (<div className="nv-page-scroll"><div className="nv-page"><PageHead icon="person" title="Person" lead="That person is not in your notes any more." actions={<button type="button" className="button" onClick={() => setWorkspace((ws) => Ws.open(ws, { type: 'people' }, 'current'))}>All people</button>} /><EmptyState size="panel" icon="people" title="Not here any more" line="They may have been merged into another card, or their note moved." /></div></div>);
  const copy = (words: string, label: string) => void navigator.clipboard.writeText(words).then(() => toast(`${label} copied.`), showError);
  /** Their role: in their own note with a page, else their role in the project naming them. An empty role
   *  adds where the value would change (t8, 8 Nov 2026, "everything is editable"). */
  const saveRole = async (v: string): Promise<boolean> => {
    if (!card) return false;
    if (card.path) return saveNoteFact(card.path, { type: card.type, page: true }, 'role', v, v.trim() ? 'Changed the role.' : 'Took the role off.');
    if (!card.namedIn) return false;
    try {
      const vw = await window.nv.projects.view(card.namedIn);
      const record = { type: card.type, title: card.name, path: card.namedIn, page: false as const };
      const change = recordFactEdit(vw.project, record, 'role', v, card.namedIn);
      if (!change || recordFactText(vw.project, record, 'role', card.namedIn) === null) {
        toast('That is not changeable here any more.');
        return false;
      }
      const r = await window.nv.projects.edit(card.namedIn, change, vw.version);
      toast(r.words, { label: 'Undo', run: () => void window.nv.projects.undo(card.namedIn!).then((u) => toast(u.words), showError) });
      return true;
    } catch (err) {
      showError(err);
      return false;
    }
  };
  const roleEditable = !!card && (!!card.namedIn || (card.type === 'person' && !!card.path));
  const orgEditable = !!card && card.type === 'person' && !!card.path;
  const roleShown = !!card?.role || (canEdit && roleEditable);
  const orgShown = !!card?.orgName || (canEdit && orgEditable);
  const lead =
    card && (card.role || card.orgName || (canEdit && (roleEditable || orgEditable))) ? (
      <EditorContext.Provider value={editor}>
        {canEdit && roleEditable ? (
          <Inline value={card.role ?? ''} label="role" placeholder="+ Role" onSave={saveRole}>
            {card.role}
          </Inline>
        ) : (
          card.role
        )}
        {roleShown && orgShown ? ' · ' : null}
        {canEdit && orgEditable ? (
          <Inline value={card.orgName} label="organisation" placeholder="+ Organisation" onSave={(v) => saveNoteFact(card.path!, { type: 'person', page: true }, 'org', v, v.trim() ? 'Changed the organisation.' : 'Took the organisation off.')}>
            {card.orgName}
          </Inline>
        ) : (
          card.orgName
        )}
      </EditorContext.Provider>
    ) : (
      'From your notes and meetings.'
    );
  const prep = () => {
    const next = card.nextMeeting;
    askInChat(`Prep me for ${next ? `my next meeting with ${card.name} (${next.title}, ${next.date ?? ''})` : `working with ${card.name}`}: what is open between us, what was decided last time, and what I should have ready. Between us now: I owe ${card.youOwe}, they owe ${card.owesYou}.`, card.path);
  };
  const remove = () => {
    if (!card.path) return;
    void A.trashPath(card.path).then((gone) => gone && setWorkspace((ws) => Ws.open(ws, { type: 'people' }, 'current')));
  };
  // The facts row reads only when something shows in it (10.1.7, t76): mail or phone, their add where it
  // would change the note, last met or the next meeting - else it leaves no gap.
  const factsShow = !!((card.path && (card.email || card.phone || (canEdit && card.type === 'person'))) || card.lastContact || card.nextMeeting?.date);
  const all = (n: number, id: string) =>
    n > 0 ? (
      <button type="button" className="pj-ov-all" onClick={() => openTab(id, { push: true })}>
        All {n} <Icon name="forward" size={12} />
      </button>
    ) : null;
  const bare = !card.youOweItems.length && !card.owesYouItems.length && !card.projects.length && !timeline.length;
  return (
    <div className="nv-page-scroll" data-tab={tab.id}>
    <div className="nv-page read w2b-person">
      {/* The head stays fixed (t255): who they are, the facts, and the tabs. */}
      <div className="pp-stickhead">
      <PageHead
        icon={<span className="pc-avatar w2b-avatar" style={{ ['--hue' as string]: personHue(card.name) }} aria-hidden="true">{initials(card.name)}</span>}
        title={card.name}
        lead={lead}
        actions={
          <>
            {card.path ? <button type="button" className="button" onClick={() => A.openPath(card.path!, { where: 'current' })}><Icon name="notes" size={14} /> Their note</button> : null}
            <button type="button" className="button primary" onClick={prep}><Icon name="sparkle" size={14} /> {card.nextMeeting ? 'Prep for next meeting' : 'Prep for working together'}</button>
            {card.path ? (
              <button type="button" className="iconbtn" aria-label={`More for ${card.name}`} title="More" onClick={(e) => openMenu(e.currentTarget, [
                { label: 'Open their note in a new tab', icon: 'newTab' as const, run: () => A.openPath(card.path!, { where: 'tab' }) },
                { label: 'Delete their note to the Bin', icon: 'trash' as const, danger: true, disabled: !canEdit, run: remove },
              ])}><Icon name="more" size={15} /></button>
            ) : null}
          </>
        }
      />
      {/* The facts as one row of pills (round 2, the mock): mail, phone, last met and the next meeting. A click
        copies; the pencil changes it in their note. Missing mail or phone still offers its add (t8, 8 Nov 2026,
        "everything is editable"): the placeholder writes it in their note, where the value would change. */}
      {factsShow && (
        <div className="metapills">
          <EditorContext.Provider value={editor}>
            {card.email && card.path ? (
              <button type="button" className="pill outline" onClick={() => copy(card.email!, 'Email')} title="Copy their email">
                <Icon name="copy" size={13} />{' '}
                {canEdit && card.type === 'person' ? (
                  <Inline value={card.email} label="email" onSave={(v) => saveNoteFact(card.path!, { type: card.type, page: true }, 'email', v, v.trim() ? 'Changed the email.' : 'Took the email off.')}>
                    {card.email}
                  </Inline>
                ) : (
                  card.email
                )}
              </button>
            ) : canEdit && card.path && card.type === 'person' ? (
              <span className="pill outline" title="Add their email">
                <Inline value="" label="email" placeholder="Add an email" onSave={(v) => saveNoteFact(card.path!, { type: card.type, page: true }, 'email', v, v.trim() ? 'Changed the email.' : 'Took the email off.')}>{undefined}</Inline>
              </span>
            ) : null}
            {card.phone && card.path ? (
              <button type="button" className="pill outline" onClick={() => copy(card.phone!, 'Phone')} title="Copy their phone number">
                <Icon name="copy" size={13} />{' '}
                {canEdit && card.type === 'person' ? (
                  <Inline value={card.phone} label="phone" onSave={(v) => saveNoteFact(card.path!, { type: card.type, page: true }, 'phone', v, v.trim() ? 'Changed the phone number.' : 'Took the phone number off.')}>
                    {card.phone}
                  </Inline>
                ) : (
                  card.phone
                )}
              </button>
            ) : canEdit && card.path && card.type === 'person' ? (
              <span className="pill outline" title="Add their phone number">
                <Inline value="" label="phone" placeholder="Add a phone number" onSave={(v) => saveNoteFact(card.path!, { type: card.type, page: true }, 'phone', v, v.trim() ? 'Changed the phone number.' : 'Took the phone number off.')}>{undefined}</Inline>
              </span>
            ) : null}
          </EditorContext.Provider>
          {card.lastContact ? <span className="pill slate" title="From your meetings with them.">Last met {dayWords(card.lastContact.date)}</span> : null}
          {card.nextMeeting?.date ? <span className="pill blue" title="Your next meeting with them.">{nextMeetingWords(card.nextMeeting.date, today)}</span> : null}
        </div>
      )}
      {/* Gone quiet (10.0 v2locked): one line with a drafted check-in, put in the chat box, never sent. */}
      {card.quiet ? (
        <div className="callout slate" style={{ marginTop: 12 }}>
          <span aria-hidden="true">◈</span>
          <span>Quiet for {spanWords(card.quiet.days)}{card.quiet.usualDays !== undefined ? `, usually every ${spanWords(card.quiet.usualDays)}` : ''}.</span>
          <button type="button" className="button small" style={{ marginLeft: 'auto' }} onClick={() => draftInChat(checkInDraft(card))}>Draft check-in</button>
        </div>
      ) : null}
      <PageTabs tabs={tabDefs} active={active} onOpen={(id) => openTab(id, { push: true })} label={`${card.name}'s sections`} focusSignal={focusSignal} idPrefix="pp" />
      </div>

      {PERSON_TABS.map(
        (t) =>
          isMounted(t.id) && (
            <section key={t.id} role="tabpanel" id={`pp-panel-${t.id}`} aria-labelledby={`pp-tab-${t.id}`} tabIndex={0} style={{ display: active === t.id ? undefined : 'none' }}>
              {t.id === 'overview' ? (
                bare ? (
                  <p className="vsub">Nothing with {card.name} yet.</p>
                ) : (
                  <div className="pp-ov">
                    <section className="pj-ov-block" aria-label="You owe">
                      {card.youOweItems.length > 0 ? (
                        <>
                          <ActionCard title="You owe" items={card.youOweItems} empty="Nothing you owe them is open." today={today} limit={3} wrap />
                          {all(card.youOweItems.length, 'promises')}
                        </>
                      ) : (
                        <>
                          <div className="glabel w2b-group">You owe</div>
                          <p className="pj-faint">Nothing you owe them is open.</p>
                        </>
                      )}
                    </section>
                    <section className="pj-ov-block" aria-label="Owes you">
                      {card.owesYouItems.length > 0 ? (
                        <>
                          <ActionCard title="Owes you" items={card.owesYouItems} empty="Nothing they owe you is open." today={today} limit={3} wrap />
                          {all(card.owesYouItems.length, 'promises')}
                        </>
                      ) : (
                        <>
                          <div className="glabel w2b-group">Owes you</div>
                          <p className="pj-faint">Nothing they owe you is open.</p>
                        </>
                      )}
                    </section>
                    <section className="pj-ov-block" aria-label="Projects">
                      <h2>Projects</h2>
                      {card.projects.length === 0 ? (
                        <p className="pj-faint">No shared projects.</p>
                      ) : (
                        <>
                          {card.projects.map((p) => (
                            <div className="trow compact" key={p.id}>
                              <span className="gtile xs green" aria-hidden="true">
                                <Icon name="layers" size={13} />
                              </span>
                              <button type="button" className="t pj-ov-open" style={{ whiteSpace: 'normal', overflowWrap: 'break-word' }} title={p.title} onClick={() => (p.path ? A.openPath(p.path, { where: 'current' }) : peek({ id: p.id }))}>
                                {p.title}
                              </button>
                            </div>
                          ))}
                          {all(card.projects.length, 'projects')}
                        </>
                      )}
                    </section>
                    <section className="pj-ov-block" aria-label="Latest timeline">
                      <h2>Latest timeline</h2>
                      {timeline.length === 0 ? (
                        <p className="pj-faint">No meetings, finished promises or notes yet.</p>
                      ) : (
                        <>
                          {timeline.slice(0, 5).map((e) => (
                            <div className="trow compact" key={`${e.kind}:${e.id}`}>
                              <span className={`gtile xs ${e.kind === 'meeting' ? 'blue' : e.kind === 'action' ? 'amber' : 'slate'}`} aria-hidden="true">
                                <Icon name={e.kind === 'meeting' ? 'calendar' : e.kind === 'action' ? 'task' : 'notes'} size={13} />
                              </span>
                              <button type="button" className="t pj-ov-open" style={{ whiteSpace: 'normal', overflowWrap: 'break-word' }} title={e.title} onClick={() => (e.path ? A.openPath(e.path, { where: 'current', ...(e.line !== undefined ? { line: e.line } : {}) }) : peek({ id: e.id }))}>
                                {e.title}
                              </button>
                              <span className="meta w2b-when" style={{ marginLeft: 'auto' }}>
                                {e.kind === 'meeting' && e.date ? `${e.date >= today ? 'Coming up' : 'Past'} · ${dayWords(e.date)}` : null}
                                {e.kind === 'meeting' && !e.date ? 'Meeting · no day set' : null}
                                {e.kind === 'action' ? 'Done' : null}
                                {e.kind === 'note' ? 'Note' : null}
                              </span>
                            </div>
                          ))}
                          {all(timeline.length, 'timeline')}
                        </>
                      )}
                    </section>
                  </div>
                )
              ) : t.id === 'promises' ? (
                card.youOweItems.length + card.owesYouItems.length === 0 ? (
                  <p className="pj-faint">No open promises between you.</p>
                ) : (
                  <>
                    <TabFind id="promises" open={active === 'promises'} />
                    <div className="w2b-halves">
                      {card.youOweItems.length > 0 && <ActionCard title="You owe" items={card.youOweItems} empty="Nothing you owe them is open." today={today} />}
                      {card.owesYouItems.length > 0 && <ActionCard title="Owes you" items={card.owesYouItems} empty="Nothing they owe you is open." today={today} />}
                    </div>
                  </>
                )
              ) : t.id === 'projects' ? (
                card.projects.length === 0 ? (
                  <p className="pj-faint">No shared projects.</p>
                ) : (
                  <>
                    <TabFind id="projects" open={active === 'projects'} />
                    {/* The projects they are on (t8, 8 Nov 2026, "everything feels connected"): each opens where it is. */}
                    <div className="glabel w2b-group w2b-section">Projects</div>
                    <div className="card w2b-card">
                      {card.projects.map((p) => (
                        <button key={p.id} type="button" className="trow w2b-row" title={p.title} onClick={() => (p.path ? A.openPath(p.path, { where: 'current' }) : peek({ id: p.id }))}>
                          <span className="gtile xs green" aria-hidden="true">
                            <Icon name="layers" size={13} />
                          </span>
                          <span className="t clip">{p.title}</span>
                          <span className="meta w2b-when">Project</span>
                        </button>
                      ))}
                    </div>
                  </>
                )
              ) : timeline.length === 0 ? (
                <p className="pj-faint">No meetings, finished promises or notes yet.</p>
              ) : (
                <>
                  <TabFind id="timeline" open={active === 'timeline'} />
                  <div className="glabel w2b-group w2b-section">Timeline</div>
                  <div className="card w2b-card">
                    {timeline.slice(0, timelineCount).map((e) => (
                      <button
                        key={`${e.kind}:${e.id}`}
                        type="button"
                        className="trow w2b-row"
                        title={e.title}
                        onClick={() => (e.path ? A.openPath(e.path, { where: 'current', ...(e.line !== undefined ? { line: e.line } : {}) }) : peek({ id: e.id }))}
                      >
                        <span className={`gtile xs ${e.kind === 'meeting' ? 'blue' : e.kind === 'action' ? 'amber' : 'slate'}`} aria-hidden="true">
                          <Icon name={e.kind === 'meeting' ? 'calendar' : e.kind === 'action' ? 'task' : 'notes'} size={13} />
                        </span>
                        <span className="t clip">{e.title}</span>
                        <span className="meta w2b-when">
                          {e.kind === 'meeting' && e.date ? `${e.date >= today ? 'Coming up' : 'Past'} · ${dayWords(e.date)}` : null}
                          {e.kind === 'meeting' && !e.date ? 'Meeting · no day set' : null}
                          {e.kind === 'action' ? `${e.side === 'they owe' ? 'They owe' : 'You owe'} · done` : null}
                          {e.kind === 'note' ? 'Note' : null}
                        </span>
                      </button>
                    ))}
                  </div>
                  {timeline.length > timelineCount && (
                    <div className="w2b-more">
                      <button type="button" className="btn quiet" onClick={() => setTimelineCount((n) => n + 50)}>
                        Show more ({timeline.length - timelineCount} left)
                      </button>
                    </div>
                  )}
                </>
              )}
            </section>
          ),
      )}
    </div>
    </div>
  );
}
