// Home (8.7 wave 1, item 3; 30 Oct 2026): the person's areas and overview. Since 3 Nov 2026 (audit f F4: Today and
// Home were the same page) Home and Today have different jobs: Today is what needs me now (due, meetings, the brief),
// Home is where things live (areas, projects, recent, the Inbox, the pack cards). Asking, finding and doing moved to
// the header bar's panel on 4 Nov 2026, so this file keeps the person's cards — the Inbox, recently viewed, and the
// pack cards (bills, habits, the weekly update, family) while their packs are switched on — arranged by the registry
// (src/shared/home-cards.ts), kept per vault across restarts, through Change cards here and Settings › Home cards.

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Brief, BriefItem } from '../../../shared/brief';
import { kindWords } from '../../../shared/brief';
import { dayOf, nextBirthday, type Happening } from '../../../shared/family';
import { billsDue, dueWords, moneyWords } from '../../../shared/finance';
import { addDays, dayWords, entryOn, measureStreak, timeWords, todayIso } from '../../../shared/health';
import { CORE_HOME_CARDS, defaultHomeLayout, EXTRA_HOME_CARDS, extrasOf, homeOffers, HOME_CARDS, moveHomeCard, normalizeHomeLayout, setHomeCard, type HomeCardDef, type HomeCardId, type HomeLayout } from '../../../shared/home-cards';
import { weekShort } from '../../../shared/weekly-updates';
import type { AreaCounts } from '../../../shared/areas';
import { MOVING_IN_MIN_NOTES, shouldShowMovingIn } from '../../../shared/areas';
import { isFreshVault, isOwnNote } from '../../../shared/vault-place';
import { moduleOn as moduleIsOn } from '../../../shared/life-modules';
import type { ProjectCard } from '../../../shared/types';
import { isOpenProject } from '../../../shared/project-standing';
import { isDayShaped } from '../../../shared/days';
import { isPersonNote } from '../../../shared/tasks';
import { plural } from '../../../shared/words';
import { openTypePage } from '../state/noteTypes';
import { fileIcon, Icon } from '../components/Icon';
import { openMenu } from '../components/Menu';
import { dueWords as projectDueWords, hashTint, readDate } from '../lib/projectLook';
import { headerOverflowHidden, overflowMenuItems } from '../lib/headerOverflow';
import { CardGuard } from '../components/ErrorBoundary';
import * as A from '../state/actions';
import { openModal } from '../state/modals';
import { openStarterPicker } from '../state/abilities';
import { showError, toast, useApp, usePrefs } from '../state/store';
import { billRowTag, justPaid, payableByHand } from './modules/billRow';
import { markPaid, openBill } from './modules/recordActions';
import { useFinance } from '../state/recordModules';
import { useFamily } from './modules/FamilyPage';
import { H, useHealth } from './modules/health/useHealth';
import { openModule, useModules, useModuleOn, usePartOn } from '../state/modules';
import { usePluginCards } from '../state/plugins';
import { openInbox, openLife, openPeople } from '../state/life';
import { useWork } from '../state/workModules';
import { runBriefAction } from './today/BriefCard';
import { areaOfPath, openArea, useAreaCounts, useAreas } from '../state/areas';
import { useInboxCount } from '../panels/AreasPlaces';
import { getWorkspace } from '../state/layout';
import { ViewHeader } from './ViewHeader';
import type { TabState } from '../state/workspace';

/** Rows in a card before "See all". */
const SHOWN = 5;

/** A card's frame: the group label above it, then the kit card. */
function Card({ id, children, wide, glass }: { id: string; children: React.ReactNode; wide?: boolean; glass?: boolean }) {
  const def = HOME_CARDS.find((c) => c.id === id);
  return (
    <section aria-label={def?.title ?? id}>
      <div className="glabel home-label">{(def?.title ?? id)}</div>
      <div className={`card home-card${wide ? ' is-wide' : ''}${glass ? ' is-glass' : ''}`}>{children}</div>
    </section>
  );
}

/** The morning brief: every line the seam ranked, each with its action and "Not useful". The kind tag stays slate
 *  (10.0 rooms critique, 2 Nov 2026: painting it from the tone put one kind in two colours on one screen, and tone
 *  'bad' fell into slate so the overdue rows read calmest; the titles and details already carry the standing in
 *  words). Bills and quiet friends (10.0) read through the same rows. Glass on the one page, where it sits under
 *  the hero. */
export function BriefCardHome({ brief, onHide, reload, glass }: { brief: Brief | null; onHide(id: string): void; reload(): void; glass?: boolean }) {
  const canEdit = useApp((s) => s.canEdit);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  if (!brief) return null;
  const shown = brief.items.filter((i) => !hidden.has(i.id));
  const notUseful = (item: BriefItem) => {
    setHidden((s) => new Set(s).add(item.id));
    void window.nv.brief.notUseful(item.id).then(
      () => {
        onHide(item.id);
        toast('Hidden. Lines like it will come lower in the brief.', { label: 'Undo', run: () => { setHidden((s) => { const n = new Set(s); n.delete(item.id); return n; }); void window.nv.brief.usefulAgain(item.id).catch(showError); } });
      },
      (err) => {
        setHidden((s) => { const n = new Set(s); n.delete(item.id); return n; });
        showError(err);
      },
    );
  };
  return (
    <Card id="brief" glass={glass}>
      {shown.length === 0 ? (
        <div className="home-quiet"><b>Nothing pressing.</b><p>Your notes, reminders and projects are all in hand.</p></div>
      ) : (
        shown.map((item) => {
          const [main] = item.actions;
          // The title goes to the row's thing (4 Nov 2026, p15-today-rest: every row opens what it names). Its open
          // target when it has one, wherever it sits in the actions (a quiet friend's row keeps Draft check-in on
          // its button and opens the person from its title), else the main action when that opens something (a card
          // review, a link, a meeting note). Asking and snoozing stay on their buttons, since a title that drafts or
          // snoozes would surprise, and a line with nowhere to go (a source that failed to read) stays plain words.
          const openAct = item.actions.find((a) => a.kind === 'open');
          const titleAct = openAct ?? (main && (main.kind === 'review' || main.kind === 'url' || main.kind === 'meeting') ? main : undefined);
          return (
            <div key={item.id} className="trow">
              <span className="tag slate">{kindWords(item.kind)}</span>
              {titleAct ? (
                <button className="home-open" title={titleAct.label} onClick={(e) => runBriefAction(titleAct, e.currentTarget, { canEdit, reload })}>
                  <span className="t clip-2">{item.title}</span>
                  {item.detail && <span className="meta clip-2">{item.detail}</span>}
                </button>
              ) : (
                <span className="home-open">
                  <span className="t clip-2">{item.title}</span>
                  {item.detail && <span className="meta clip-2">{item.detail}</span>}
                </span>
              )}
              {main && (
                <button className="btn quiet home-act" aria-haspopup={main.kind === 'snooze' ? 'menu' : undefined} disabled={!canEdit && (main.kind === 'meeting' || main.kind === 'snooze')} onClick={(e) => runBriefAction(main, e.currentTarget, { canEdit, reload })}>
                  {main.label}
                </button>
              )}
              <button className="iconbtn home-x" title="Not useful" aria-label={`Not useful: ${item.title}`} onClick={() => notUseful(item)}><Icon name="close" size={12} /></button>
            </div>
          );
        })
      )}
    </Card>
  );
}

/** The Inbox: how many wait, one action to file them. */
export function InboxCard({ count }: { count: number }) {
  return (
    <Card id="inbox">
      <div className="home-count">
        <b>{count}</b>
        <span>{count === 1 ? 'capture waiting to be filed.' : 'captures waiting to be filed.'}</span>
        <button className="btn push" onClick={() => openInbox()}>Open Inbox</button>
      </div>
    </Card>
  );
}

/** Recently viewed: the pages opened lately, each back open in one click (8.7 wave 1 polish, 30 Oct 2026: the
 *  home mock-up's four tinted cards with an icon and a two-line title, each its own card; always drawn, with an
 *  honest line when nothing has been viewed yet). */
export function RecentCard({ recent }: { recent: string[] }) {
  const shown = recent.slice(0, 4);
  const def = HOME_CARDS.find((c) => c.id === 'recent');
  const label = def?.title ?? 'recent';
  return (
    <section aria-label={def?.title ?? 'recent'}>
      <div className="glabel home-label">{label}</div>
      {shown.length === 0 ? (
        <div className="card home-card">
          <div className="home-quiet"><b>Nothing viewed yet.</b><p>Pages you open will show up here.</p></div>
        </div>
      ) : (
        <div className="home-recent">
          {shown.map((p) => (
            <button key={p} className="card home-cell" title={A.titleOf(p)} onClick={() => A.openPath(p)}>
              <span className={`gtile xs ${hashTint(p)}`}><Icon name={fileIcon(p)} size={14} /></span>
              <span className="home-cell-t">{A.titleOf(p)}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

/** Bills due: overdue and coming up from the Finance pack, marked paid here. */
export function BillsCard() {
  const billsOn = usePartOn('finance', 'bills');
  const canEdit = useApp((s) => s.canEdit);
  const { data: f } = useFinance(billsOn);
  if (!billsOn || !f) return null;
  // The one due list (3 Nov 2026, fourth-round G1): the brief and Today's figures count this same list, over every
  // bill (not just dueSoon, so earlier warning past 14 days is counted too). Just-paid rows stay visible with Paid
  // plus their next day (9.2 uplift F3); the total counts only what is still due, over every due bill, not just the
  // rows shown (fnv3 F5).
  const owed = billsDue(f.bills, f.remindDays, f.today);
  const paidRows = f.bills.filter((b) => justPaid(b, f.today)).sort((a, b) => (a.next ?? '').localeCompare(b.next ?? ''));
  const allDue = [...owed, ...paidRows].sort((a, b) => (a.next ?? '').localeCompare(b.next ?? ''));
  const due = allDue.slice(0, SHOWN);
  const total = allDue.filter((b) => !justPaid(b, f.today)).reduce((s, b) => s + (b.amount ?? 0), 0);
  return (
    <Card id="bills">
      {due.length === 0 ? (
        <div className="home-quiet"><b>No bills due.</b><p>Nothing overdue or coming up in the next {Math.max(7, f.remindDays)} days.</p></div>
      ) : (
        <>
          <p className="home-line">{moneyWords(total, f.currency)} due in the next {Math.max(7, f.remindDays)} days</p>
          {due.map((b) => (
            <div key={b.path} className="trow">
              <button className="home-open" title="Open the bill" onClick={() => openBill(b.path, b.name)}>
                <span className="t clip-2">{b.name}</span>
                <span className="meta clip-2">{justPaid(b, f.today) ? billRowTag(b, f.today).words : b.overdue && b.next ? billRowTag(b, f.today).words : b.next ? dueWords(b.next, f.today) : ''}{b.autopay ? ' · autopay' : ''}</span>
              </button>
              <span className="meta push">{b.amount !== null ? moneyWords(b.amount, f.currency) : ''}</span>
              {payableByHand(b, f.today) && <button className="btn quiet home-act" disabled={!canEdit} title={`Mark ${b.name} paid`} onClick={() => markPaid(b)}>Paid</button>}
            </div>
          ))}
        </>
      )}
      <div className="home-more"><button className="home-seeall" onClick={() => openModule('finance', 'calendar')}>Money <Icon name="forward" size={13} /></button></div>
    </Card>
  );
}

/** Habits to tick: today's yes or no for each habit, with its run. */
export function HabitsCard() {
  const habitsOn = usePartOn('health', 'habits');
  const canEdit = useApp((s) => s.canEdit);
  const { db, act } = useHealth();
  if (!habitsOn || !db) return null;
  const today = todayIso();
  const habits = db.measures.filter((m) => m.group === 'habit' && m.kind === 'yesno').slice(0, SHOWN);
  if (!habits.length) {
    return (
      <Card id="habits">
        <div className="home-quiet"><b>No habits yet.</b><p>Any yes or no to keep each day.</p>
          {canEdit && <button className="btn" onClick={() => openModule('health', 'habits')}>Start one</button>}
        </div>
      </Card>
    );
  }
  return (
    <Card id="habits">
      {habits.map((m) => {
        const entry = entryOn(db, m.id, today);
        const yes = entry?.yes === true;
        const streak = measureStreak(db, m.id, today);
        return (
          <div key={m.id} className="trow">
            <button className={`check${yes ? ' done' : ''}`} role="checkbox" aria-checked={yes} aria-label={`${yes ? 'Untick' : 'Tick'} ${m.name} for today`} title={yes ? 'Ticked for today (click to untick)' : 'Tick for today'} disabled={!canEdit} onClick={() => void act(H().entry(m.id, today, !yes), yes ? `Unticked ${m.name}.` : `Ticked ${m.name}.`)}>
              {yes ? <Icon name="check" size={12} /> : null}
            </button>
            <span className="home-open">
              <span className={`t clip${yes ? ' is-done' : ''}`}>{m.name}</span>
              {streak.current > 1 && <span className="meta clip">{streak.current} days in a row</span>}
            </span>
          </div>
        );
      })}
      <div className="home-more"><button className="home-seeall" onClick={() => openModule('health', 'habits')}>Health <Icon name="forward" size={13} /></button></div>
    </Card>
  );
}

/** This week's update: how far it is written, and when it is due. */
export function WeeklyCard() {
  const weeklyOn = useModuleOn('weekly');
  const { data: view } = useWork<{ due: { state: string; overdue?: boolean; dueToday?: boolean; dueDay: string }; current: { sections: { progress: string; status: string }[] } | null; thisWeek: string }>('weekly', 'model', [], weeklyOn);
  if (!weeklyOn || !view) return null;
  if (view.due.state === 'sent') return <Card id="weekly"><div className="home-quiet"><b>Sent for this week.</b><p>Next week's update gathers here.</p></div></Card>;
  const u = view.current;
  const filled = u ? u.sections.filter((s) => s.progress.length || s.status.trim()).length : 0;
  const d = view.due;
  return (
    <Card id="weekly">
      <div className="trow">
        <span className={`tag ${d.overdue || d.dueToday ? 'coral' : 'slate'}`}>{d.overdue ? 'Overdue' : d.dueToday ? 'Due today' : `Due ${dayWords(d.dueDay, todayIso())}`}</span>
        <button className="home-open" title="Open this week's update" onClick={() => openModule('weekly')}>
          <span className="t clip-2">This week’s update</span>
          <span className="meta clip-2">{weekShort(view.thisWeek)} · {u ? `Draft · ${filled} of ${u.sections.length} written` : 'Not started yet'}</span>
        </button>
      </div>
    </Card>
  );
}

/** Family today: who's where, birthdays ahead, rewards earned but not yet given. */
export function FamilyCard() {
  const { state } = useFamily();
  const calendarOn = usePartOn('family', 'calendar');
  const rewardsOn = usePartOn('family', 'rewards');
  const sw = useModules();
  if (!state || !moduleIsOn(sw, 'family')) return null;
  const today = todayIso();
  const tomorrow = addDays(today, 1);
  const rows: { key: string; when: string; words: string; sub?: string; part: string }[] = [];
  const add = (h: Happening, when: string, part = 'calendar') =>
    rows.push({ key: `${when}-${h.kind}-${h.row ?? h.what}`, when: `${when}${h.time ? ` ${timeWords(h.time)}` : ''}`, words: h.what, sub: [h.who.join(', '), h.where].filter(Boolean).join(' · ') || undefined, part });
  if (calendarOn) {
    for (const h of dayOf(state.calendar, state.members, today)) add(h, 'Today');
    for (const h of dayOf(state.calendar, state.members, tomorrow)) add(h, 'Tomorrow');
  }
  for (const m of state.members) {
    const b = nextBirthday(m.born, today);
    if (b && b.in >= 0 && b.in <= 7) rows.push({ key: `bday-${m.path}`, when: dayWords(b.day, today), words: `${m.name} turns ${b.age}`, sub: b.in === 0 ? 'today' : b.in === 1 ? 'tomorrow' : `in ${b.in} days`, part: 'members' });
  }
  if (rewardsOn) for (const r of state.rewards) if (r.earned) rows.push({ key: `reward-${r.path}`, when: 'Earned', words: `${r.who || r.title}: ${r.earned.reward}`, sub: 'not given yet', part: 'rewards' });
  if (!rows.length) return <Card id="family"><div className="home-quiet"><b>Nothing on for the family.</b><p>Today and tomorrow are clear.</p></div></Card>;
  return (
    <Card id="family">
      {rows.slice(0, SHOWN).map((r) => (
        <div key={r.key} className="trow">
          <span className="home-when">{r.when}</span>
          <button className="home-open" title="Open in Family" onClick={() => openModule('family', r.part)}>
            <span className="t clip-2">{r.words}</span>
            {r.sub && <span className="meta clip-2">{r.sub}</span>}
          </button>
        </div>
      ))}
      {/* The rows past five had no way to be seen (Nov 2026 review): the card's link, as the Bills and Habits cards have. */}
      <div className="home-more"><button className="home-seeall" onClick={() => openModule('family')}>Family <Icon name="forward" size={13} /></button></div>
    </Card>
  );
}

/** The person's arrangement, kept per vault (over restarts) and normalised on the way in and out. */
export function useHomeLayout(vault: string | undefined): [HomeLayout, (next: HomeLayout) => void] {
  const [layout, setLayout] = useState<HomeLayout>(defaultHomeLayout());
  useEffect(() => {
    setLayout(defaultHomeLayout());
    if (!vault) return;
    let live = true;
    void window.nv.state.load('home-cards').then(
      (saved) => live && saved !== null && setLayout(normalizeHomeLayout(saved)),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [vault]);
  const save = useCallback(
    (next: HomeLayout) => {
      setLayout(next);
      if (vault) void window.nv.state.save('home-cards', next).catch(() => undefined);
    },
    [vault],
  );
  return [layout, save];
}

/** Change cards (5 Nov 2026, Home folded into Today, one morning place): the cards on the left (moved,
 *  taken away), the offer on the right (added). Due items, the brief, waiting and the rest already show above
 *  as the page itself: they keep their place and are only said so. */
export function ChangeHome({ layout, onSave, onClose }: { layout: HomeLayout; onSave(next: HomeLayout): void; onClose(): void }) {
  const [draft, setDraft] = useState(layout);
  const sw = useModules();
  const offers = useMemo(() => homeOffers(draft.on).filter((d) => (EXTRA_HOME_CARDS as string[]).includes(d.id)), [draft]);
  const defOf = (id: HomeCardId): HomeCardDef => HOME_CARDS.find((c) => c.id === id)!;
  const move = (id: HomeCardId, dir: -1 | 1) => {
    const at = draft.on.indexOf(id);
    setDraft(moveHomeCard(draft, id, at + dir));
  };
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dlg home-change" role="dialog" aria-label="Change cards">
        <h2>Change cards</h2>
        <p className="vsub">Each card has one job and one action. Cards from packs you switch on appear here too. Due items, the brief, waiting and the rest already show above.</p>
        <div className="home-change-cols">
          <div>
            <div className="glabel">On your Today · in order</div>
            {draft.on.map((id, i) => {
              const def = defOf(id);
              const core = (CORE_HOME_CARDS as string[]).includes(id);
              return (
                <div key={id} className="card home-pick">
                  <span className="home-pick-t">{def.title}{core ? ' (shows above)' : ''}</span>
                  <span className="home-pick-move">
                    <button className="iconbtn" title="Move up" aria-label={`Move ${def.title} up`} disabled={core || i === 0} onClick={() => move(id, -1)}><Icon name="chevronUp" size={14} /></button>
                    <button className="iconbtn" title="Move down" aria-label={`Move ${def.title} down`} disabled={core || i === draft.on.length - 1} onClick={() => move(id, 1)}><Icon name="chevronDown" size={14} /></button>
                  </span>
                  <button className="iconbtn" title={core ? `${def.title} shows above` : `Take ${def.title} away`} aria-label={core ? `${def.title} shows above` : `Take ${def.title} away`} disabled={core || draft.on.length <= 1} onClick={() => setDraft(setHomeCard(draft, id, false))}><Icon name="close" size={13} /></button>
                </div>
              );
            })}
          </div>
          <div>
            <div className="glabel">Add a card</div>
            <div className="card home-offer-list">
              {offers.map((def) => {
                const locked = def.pack && !moduleIsOn(sw, def.pack.module);
                return (
                  <div key={def.id} className="trow">
                    <span className="home-open">
                      <span className="t clip">{def.title}</span>
                      <span className="meta clip">{locked ? `Switch on the ${def.pack!.name} pack` : def.words}</span>
                    </span>
                    {locked ? (
                      <button className="btn small push" onClick={() => { onSave(draft); onClose(); openModal({ kind: 'settings', section: 'modules' }); }}>Packs</button>
                    ) : (
                      <button className="btn small push" onClick={() => setDraft(setHomeCard(draft, def.id, true))}>Add</button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <div className="dialog-actions">
          <button className="btn quiet" onClick={onClose}>Cancel</button>
          <button className="btn pri" onClick={() => { onSave(draft); onClose(); }}>Done</button>
        </div>
      </div>
    </div>
  );
}

/** First run on an empty vault: four small steps, then the calm empty card. The last two lines (8.8) point at
 *  what the Vault can do and the starter templates, one line each, never a wall. The first step writes here (5 Nov
 *  2026 first-ten-minutes F17: the three-key shortcut came before any note); capture stays one click below. */
export function SetupSteps({ vaultName }: { vaultName: string }) {
  const canEdit = useApp((s) => s.canEdit);
  return (
    <>
      <p className="vsub home-setup-lead">Your new vault is empty. Five small steps and it starts working for you.</p>
      <div className="card home-setup-card">
        <div className="trow"><span className="check done"><Icon name="check" size={12} /></span><span className="t">Vault created: {vaultName}</span><span className="meta push">done</span></div>
        <div className="trow"><span className="check" /><span className="t">Write your first note</span><button className="btn small push" disabled={!canEdit} onClick={() => void A.newNote()}>New note</button></div>
        <div className="trow"><span className="check" /><span className="t">Capture from anywhere <span className="meta">(press Ctrl+Alt+N)</span></span><button className="btn small push" disabled={!canEdit} onClick={() => void window.nv.capture.show()}>Capture</button></div>
        <div className="trow"><span className="check" /><span className="t">Switch on a pack <span className="meta">(Money, House, Cars…)</span></span><button className="btn small push" onClick={() => openModal({ kind: 'settings', section: 'modules' })}>Packs</button></div>
        <div className="trow"><span className="check" /><span className="t">See what Ironleaf can do <span className="meta">(every ability, grouped)</span></span><button className="btn small push" onClick={() => A.openAbilities()}>Open</button></div>
        <div className="trow"><span className="check" /><span className="t">Start from a template <span className="meta">(a CRM, habits, reading…)</span></span><button className="btn small push" disabled={!canEdit} onClick={() => openStarterPicker()}>Start</button></div>
      </div>
    </>
  );
}

/** The switched-on plugins' cards, under Home's own (8.9): each its title and a few plain lines, in Home's card shape. */
export function PluginCards() {
  const cards = usePluginCards();
  if (!cards || !cards.length) return null;
  return (
    <>
      {cards.map((c) => (
        <CardGuard key={`plugin:${c.pluginId}:${c.cardId}`} name={`plugin:${c.pluginId}`}>
          <div className="glabel home-label">{c.title}</div>
          <div className="card home-card">
            {c.failed ? (
              <div className="trow"><span className="t clip muted">{c.pluginName}’s card couldn’t load.</span></div>
            ) : c.lines.length ? (
              c.lines.map((l, i) => <div className="trow" key={i}><span className="t clip">{l}</span></div>)
            ) : (
              <div className="trow"><span className="t clip muted">Nothing to show.</span></div>
            )}
          </div>
        </CardGuard>
      ))}
    </>
  );
}

/** An area's row: its name, and what is useful — its open tasks and its next date when it holds live projects,
 *  else what it holds (its notes, people, files), else what it is for (4 Nov 2026, p15-today-rest: the rows said
 *  nothing but Open). A past date reads coral, as late dates do on Today. */
function AreaRow({ id, name, about, work, counts }: { id: string; name: string; about: string; work: { open: number; due: string | null; status?: string } | undefined; counts: AreaCounts | undefined }) {
  const holds: string[] = [];
  if (counts) {
    const kinds: [number, string, string][] = [[counts.notes, 'note', 'notes'], [counts.people, 'person', 'people'], [counts.files, 'file', 'files'], [counts.assets, 'asset', 'assets'], [counts.projects, 'project', 'projects']];
    for (const [n, one, many] of kinds) if (n > 0) holds.push(`${n} ${n === 1 ? one : many}`);
  }
  const due = work?.due ? projectDueWords(work.due, work.status) : null;
  const sub = work ? (
    <>
      {work.open === 0 ? 'No open tasks' : `${work.open} open ${work.open === 1 ? 'task' : 'tasks'}`}
      {due ? (
        <>
          {' · '}
          <span className={due.tone === 'bad' ? 'home-due-bad' : undefined}>{due.words}</span>
        </>
      ) : null}
    </>
  ) : (
    <>{holds.length ? holds.join(' · ') : about || 'Nothing here yet'}</>
  );
  return (
    <div className="trow">
      <button className="home-open" title={`Open ${name}`} onClick={() => openArea(id)}>
        <span className="t clip">{name}</span>
        <span className="meta clip-2">{sub}</span>
      </button>
      <button className="btn quiet home-act" onClick={() => openArea(id)}>Open</button>
    </div>
  );
}

/** Whether the moving-in card shows, and its hiding (t156, 9 Nov 2026: the Home fold into Today orphaned the
 *  card on an unreachable page — the one morning place reads it too, through this hook, over the person's own
 *  notes only, so a new vault's welcome note and templates never count as moving in). */
export function useMovingIn(ownCount: number): { show: boolean; hide(): void } {
  const vaultPath = useApp((s) => s.vault?.path);
  const revision = useApp((s) => s.revision);
  const areas = useAreas();
  const [projectCount, setProjectCount] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    void window.nv.projects.list().then((c) => live && setProjectCount(c.length), () => live && setProjectCount(0));
    return () => {
      live = false;
    };
  }, [revision]);
  const [seen, setSeen] = useState<boolean | null>(null);
  useEffect(() => {
    if (ownCount < MOVING_IN_MIN_NOTES) return;
    let live = true;
    void window.nv.state.load<{ seen?: boolean }>('moving-in').then(
      (v) => { if (live) setSeen(!!v?.seen); },
      () => { if (live) setSeen(false); },
    );
    return () => { live = false; };
  }, [ownCount, vaultPath]);
  return {
    show: shouldShowMovingIn(ownCount, areas, projectCount, seen),
    hide: () => {
      setSeen(true);
      void window.nv.state.save('moving-in', { seen: true }).catch(() => undefined);
    },
  };
}

/** Moving in with the notes you already have: what was found, with doors into their stuff — never "Organise by
 *  area" first. While the folder is only browsed, adopting it is one honest button away. */
export function MovingIn({ notes, onHide }: { notes: { path: string; props?: Record<string, unknown> }[]; onHide(): void }) {
  const [tasksOpen, setTasksOpen] = useState<number | null>(null);
  const [adoptable, setAdoptable] = useState<boolean | null>(null);
  const [adopting, setAdopting] = useState(false);
  useEffect(() => {
    let live = true;
    void window.nv.tasks.view().then(
      (v) => { if (live) setTasksOpen(v.facets.counts.open); },
      () => { if (live) setTasksOpen(0); },
    );
    void window.nv.place.status().then(
      (s) => { if (live) setAdoptable(!!s.adoptable); },
      () => { if (live) setAdoptable(false); },
    );
    return () => { live = false; };
  }, []);
  const folders = useMemo(() => {
    const dirs = new Set<string>();
    for (const n of notes) {
      const i = n.path.lastIndexOf('/');
      if (i > 0) dirs.add(n.path.slice(0, i));
    }
    return dirs.size;
  }, [notes]);
  const dailies = useMemo(() => notes.filter((n) => isDayShaped(n.path)).length, [notes]);
  const people = useMemo(() => notes.filter((n) => isPersonNote(n.path, n.props)).length, [notes]);
  const found = [
    `${plural(notes.length, 'note')}${folders ? ` in ${plural(folders, 'folder')}` : ''}`,
    ...(dailies ? [plural(dailies, 'daily note')] : []),
    ...(tasksOpen ? [plural(tasksOpen, 'open task')] : []),
    ...(people ? [plural(people, 'person', 'people')] : []),
  ];
  const words = found.length > 1 ? `${found.slice(0, -1).join(', ')} and ${found[found.length - 1]}` : found[0];
  const adopt = async () => {
    setAdopting(true);
    try {
      const info = await window.nv.place.adoptOpen();
      setAdoptable(false);
      toast(`“${info.name}” is your vault now.`);
    } catch (err) {
      showError(err);
    } finally {
      setAdopting(false);
    }
  };
  return (
    <div className="home-quiet">
      <b>Your notes, moved in.</b>
      <p>We found {words}. Everything is as you left it. Nothing renamed, moved or rewritten.</p>
      <div className="home-doors">
        <button className="btn" onClick={() => openTypePage('note')}>Browse notes</button>
        {dailies > 0 && <button className="btn" onClick={() => openTypePage('daily')}>Daily notes</button>}
        <button className="btn" onClick={() => A.openTasks()}>Tasks</button>
        {people > 0 && <button className="btn" onClick={() => openPeople()}>People</button>}
      </div>
      {adoptable && (
        <div className="home-adopt">
          <button className="button primary" disabled={adopting} onClick={() => void adopt()}>
            {adopting ? 'Making it yours…' : 'Make this my vault'}
          </button>
          <p className="td-faint">Ironleaf will keep its settings and templates here. Your notes stay as they are.</p>
        </div>
      )}
      <div className="home-adopt">
        <button className="home-seeall" onClick={onHide}>Hide this</button>
      </div>
    </div>
  );
}

/** Home is the person's areas and overview (3 Nov 2026, audit f F4): where things live, while Today is
 *  what needs me now. Areas first, then the Inbox, recently viewed and the pack cards in the person's own order. */
export function HomeView({ tab }: { tab: TabState }) {
  const vaultPath = useApp((s) => s.vault?.path);
  const vaultName = useApp((s) => s.vault?.name ?? 'Ironleaf');
  const notes = useApp((s) => s.notes);
  const prefsNow = usePrefs();
  // The person's own notes (t156): the welcome note and the ready-made templates are the app's, never theirs.
  const ownNotes = useMemo(() => notes.filter((n) => isOwnNote(n.path, prefsNow.templatesFolder)), [notes, prefsNow.templatesFolder]);
  const fresh = useMemo(() => isFreshVault(notes.map((n) => n.path), prefsNow.templatesFolder), [notes, prefsNow.templatesFolder]);
  const [layout, saveLayout] = useHomeLayout(vaultPath);
  const [changing, setChanging] = useState(false);
  // How many wait in the Inbox (9 Nov 2026, t119 one-tap filing: the one hook, as Today and the side bar).
  const inboxCount = useInboxCount() ?? 0;
  const areas = useAreas();
  const recent = useMemo(() => getWorkspace().recent.filter((p) => !p.includes(':')), []);
  // Each area's live work (4 Nov 2026, p15-today-rest: an area's row says what is useful — its open tasks and its
  // next date — from the same project list the area's page reads, grouped by each project's area).
  const revision = useApp((s) => s.revision);
  const byPath = useApp((s) => s.byPath);
  const [projectCards, setProjectCards] = useState<ProjectCard[] | null>(null);
  useEffect(() => {
    let live = true;
    void window.nv.projects.list().then((c) => live && setProjectCards(c), () => live && setProjectCards([]));
    return () => {
      live = false;
    };
  }, [revision]);
  // Moving in (5 Nov 2026, u3 moving-in): the person's own notes past a glance, nothing organised yet, card not hidden.
  const movingIn = useMovingIn(ownNotes.length);
  const areaCounts = useAreaCounts();
  const areaWork = useMemo(() => {
    const out = new Map<string, { open: number; due: string | null; status?: string }>();
    if (!areas || !projectCards) return out;
    for (const c of projectCards) {
      // Open work only (the one rule): held projects keep their tasks and dates out of the rows, as everywhere.
      if (!isOpenProject(c.status)) continue;
      const id = areaOfPath(c.path)?.id;
      if (id === undefined) continue;
      const cur = out.get(id) ?? { open: 0, due: null as string | null, status: undefined as string | undefined };
      cur.open += c.openNext;
      // The next date is the nearest project due, a past one first (it presses most).
      const ms = readDate(c.due);
      if (ms !== null && (cur.due === null || ms < (readDate(cur.due) ?? Infinity))) {
        cur.due = c.due ?? null;
        cur.status = c.status;
      }
      out.set(id, cur);
    }
    return out;
    // areaOfPath reads each note's area from the index (byPath) and the areas above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [areas, projectCards, byPath]);
  const extras = useMemo(() => extrasOf(layout.on), [layout]);
  const extraCards: Record<HomeCardId, React.ReactNode> = {
    due: null,
    brief: null,
    waiting: null,
    upcoming: null,
    activity: null,
    'day-note': null,
    inbox: <InboxCard count={inboxCount} />,
    recent: <RecentCard recent={recent} />,
    bills: <BillsCard />,
    habits: <HabitsCard />,
    weekly: <WeeklyCard />,
    family: <FamilyCard />,
  };
  return (
    <>
      {/* One search, at the top (4 Nov 2026): asking lives in the header bar's panel now, so the middle box
          is gone. Change cards sits in the header beside it (4 Nov 2026, p15-today-rest: a page control under the
          cards it arranges read as an afterthought, far from what it changes; 5 Nov 2026, Home folded into Today). */}
      <ViewHeader tab={tab} title="Home">
        <button type="button" className="btn quiet" data-overflow="change-home" data-overflow-order={1} onClick={() => setChanging(true)}>
          Change cards
        </button>
        {/* The header contract (Round 6, 4 Nov 2026, the reviewer: nothing may ever overlap the centred search):
            the action yields into this ⋯ when measured within 12px of the bar; it only shows while carrying it. */}
        <button type="button" className="navbtn topbar-tight-only" data-overflow-fallback="" aria-label="More for home" title="More" onClick={(e) => openMenu(e.currentTarget, overflowMenuItems(headerOverflowHidden(tab.id), {
          'change-home': () => ({ label: 'Change cards…', icon: 'settings', run: () => setChanging(true) }),
        }))}>
          <Icon name="more" size={16} />
        </button>
      </ViewHeader>
      <div className="vscroll">
        {/* The frame sets the column, the title's place and the sub line (p25 one column); the first section keeps
            the head's 24 px below them, as every room's body does. */}
        <div className="vpage wide">
          <h1 className="w2a-title">Home</h1>
          <p className="vsub">Your areas and overview.</p>
          {fresh && <SetupSteps vaultName={vaultName} />}
          <section aria-label="Areas of life" style={{ marginTop: 24 }}>
            <div className="glabel home-label">Areas of life</div>
            <div className="card home-card">
              {movingIn.show ? (
                <MovingIn notes={ownNotes} onHide={movingIn.hide} />
              ) : !areas || areas.areas.length === 0 ? (
                <div className="home-quiet">
                  <b>Bring each part of your life into one place.</b>
                  <button className="btn" onClick={() => openLife({ kind: 'migration' })}>Organise by area</button>
                </div>
              ) : (
                areas.areas.map((a) => (
                  <AreaRow key={a.id} id={a.id} name={a.name} about={a.about} work={areaWork.get(a.id)} counts={areaCounts.get(a.id)} />
                ))
              )}
            </div>
          </section>
          <div className="td-extras" style={{ marginTop: 18 }}>
            {extras.map((id) => (
              <CardGuard key={id} name={id}>
                {extraCards[id]}
              </CardGuard>
            ))}
          </div>
          {changing && <ChangeHome layout={layout} onSave={saveLayout} onClose={() => setChanging(false)} />}
          <PluginCards />
        </div>
      </div>
    </>
  );
}
