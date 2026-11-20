// Family's 8.7 pages (30 Oct 2026): the overview (family.html: the week ahead, each person, milestones, papers,
// albums, the home card) and a person's page (family-person.html). Every ability the old parts had lives here: one-day
// events and weekly activities added, changed and removed where shown; members added, changed, and their card deleted
// to the Bin; milestones kept and changed; reward trackers ticked, claimed and changed; documents opened; albums made,
// filled and moved in from the old folders. One primary button per screen.

import { useEffect, useMemo, useState } from 'react';
import type { FamilyState } from '../../../../../main/modules';
import { ageOn, daysFrom, forPerson, nextBirthday, type Activity, type FamilyEvent, type Happening, type Member, type Milestone, type Reward } from '../../../../../shared/family';
import { dayWords, timeWords, todayIso } from '../../../../../shared/health';
import { plural } from '../../../../../shared/words';
import { openMenu } from '../../../components/Menu';
import { writeLink } from '../../../lib/links';
import * as A from '../../../state/actions';
import { closeTours, openTour } from '../../../state/moduleFills';
import { openModal } from '../../../state/modals';
import { openModule, partOfTab, usePartOn } from '../../../state/modules';
import { toast } from '../../../state/store';
import { useWork } from '../../../state/workModules';
import type * as W from '../../../state/workspace';
import { ActivityForm, colourOf, EventForm, MemberForm, MilestoneForm, RewardCard, RewardForm, useFamily } from '../FamilyPage';
import { CreativePage, PersonPage, newAlbum, openAlbum, span, type MemoriesView } from '../life/MemoriesPage';
import { Cover } from './Memories87';
import { AskFloat, EmptyState, FillsLine, HomeCard, MoreButton, PackHead, PackPage, PageProps, RowsCard, Section, trashRecord, useCanEdit, FULL_DETAILS_LABEL } from './W3b';
import { deleteToBin } from '../../../lib/removeWords';

type Tint = 'slate' | 'green' | 'amber' | 'red' | 'blue';
const tintOf = (colour: string): Tint => ({ rose: 'red', sky: 'blue', ochre: 'amber', sage: 'green', plum: 'slate', teal: 'green', clay: 'amber', slate: 'slate', stone: 'slate' })[colour] as Tint ?? 'slate';
export const openMember = (path: string) => openModule('family', `member:${encodeURIComponent(path)}`);
const memberPathOf = (tab: W.TabState): string | null => {
  const part = partOfTab(tab) ?? '';
  if (!part.startsWith('member:')) return null;
  try { return decodeURIComponent(part.slice(7)); } catch { return part.slice(7); }
};
const firstOf = (name: string) => name.split(/\s+/).filter(Boolean)[0] ?? name;

/** A form in the kit dialog, closed on done. */
function FormDialog({ title, onDone, children }: { title: string; onDone(): void; children: React.ReactNode }) {
  // A tour left open would sit dimmed behind the dialog with its Close unreachable (p14, 4 Nov 2026).
  useEffect(() => closeTours(), []);
  return (
    <div className="overlay" role="presentation" onClick={onDone}>
      <div className="dialog" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

type FormKind = { kind: 'event'; e?: FamilyEvent; date?: string } | { kind: 'activity'; a?: Activity } | { kind: 'milestone'; m?: Milestone } | { kind: 'member'; m?: Member } | { kind: 'reward'; r?: Reward } | null;

function AddMenu({ onPick, onAlbum }: { onPick(f: Exclude<FormKind, null>): void; onAlbum(): void }) {
  const canEdit = useCanEdit();
  if (!canEdit) return null;
  return (
    <button
      type="button" className="btn pri" onClick={(e) => openMenu(e.currentTarget, [
        { label: 'A one-day event…', icon: 'calendar', run: () => onPick({ kind: 'event' }) },
        { label: 'Something each week…', icon: 'history', run: () => onPick({ kind: 'activity' }) },
        { label: 'Keep a milestone…', icon: 'flag', run: () => onPick({ kind: 'milestone' }) },
        { label: 'Add someone…', icon: 'people', run: () => onPick({ kind: 'member' }) },
        { label: 'New reward tracker…', icon: 'star', run: () => onPick({ kind: 'reward' }) },
        { label: 'New album…', icon: 'image', run: onAlbum },
      ])}
    >
      + Add an event
    </button>
  );
}

function moreMenu(el: HTMLElement, state: FamilyState | null, mem: MemoriesView | null) {
  openMenu(el, [
    { label: 'Every album', icon: 'image', run: () => openModule('family', 'albums') },
    { label: 'By person', icon: 'people', run: () => openModule('family', 'people') },
    { label: 'Creative projects', icon: 'canvas', run: () => openModule('family', 'creative') },
    { label: 'Show the albums folder', icon: 'folder', disabled: !mem, run: () => mem && A.revealInExplorer(mem.folder) },
    { separator: true },
    { label: 'Open the family calendar note', icon: 'calendar', disabled: !state, run: () => state && A.openPath(state.calendarPath) },
    { label: 'Who reads Family-private…', icon: 'lock', run: () => openModal({ kind: 'settings', section: 'privacy' }) },
    { label: 'Family’s parts (Settings › Packs)…', icon: 'settings', run: () => openModal({ kind: 'settings', section: 'modules' }) },
    { label: 'Show me around Family', icon: 'sparkle', run: () => openTour('family') },
    { separator: true },
    { label: FULL_DETAILS_LABEL, icon: 'history', run: () => openModule('family', 'classic') },
  ]);
}

/** One happening as a small tinted block; birthdays read, the rest open their form. */
function HappeningBlock({ h, members, onOpen }: { h: Happening; members: Member[]; onOpen(): void }) {
  const tint = tintOf(colourOf(h.who, members));
  const words = `${h.time ? `${timeWords(h.time)} ` : ''}${h.what}${h.who.length ? `, ${h.who.join(', ')}` : ''}${h.where ? `, at ${h.where}` : ''}`;
  if (h.kind === 'birthday') return <span className={`w3b-evt ${tint}`} title={words}>{h.what}</span>;
  return <button type="button" className={`w3b-evt ${tint}`} title={`${words} (click to change it)`} onClick={onOpen}>{h.time ? `${timeWords(h.time)} ` : ''}{h.what}</button>;
}

// ── The overview ───────────────────────────────────────────────────────────────────────────────────────────────────

export function FamilyOverview({ tab }: { tab: W.TabState }) {
  void tab;
  const { state, failed } = useFamily();
  const canEdit = useCanEdit();
  const calOn = usePartOn('family', 'calendar');
  const msOn = usePartOn('family', 'milestones');
  const rwOn = usePartOn('family', 'rewards');
  const docsOn = usePartOn('family', 'documents');
  const albumsOn = usePartOn('family', 'albums');
  const [who, setWho] = useState<string | null>(null);
  const [form, setForm] = useState<FormKind>(null);
  // Albums answer under Family since the merge (packs uplift item 5): the record machinery still answers on its
  // own name while Family is on.
  const { data: mem } = useWork<MemoriesView>('memories');
  const today = todayIso();
  const days = useMemo(() => (state ? daysFrom(state.calendar, state.members, today, 7).map((d) => ({ ...d, items: who ? forPerson(d.items, who) : d.items })) : []), [state, today, who]);
  const count = days.reduce((n, d) => n + d.items.length, 0);
  const onTrack = (state?.rewards ?? []).filter((r) => r.streak.today === true || (r.streak.current > 0 && !r.earned)).length;
  const recent = useMemo(() => (state ? [...state.calendar.milestones].filter((m) => !who || m.who.some((w) => w.toLowerCase() === who.toLowerCase())).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5) : []), [state, who]);
  const openHappening = (h: Happening) => {
    if (!canEdit || !state || h.row === undefined) return;
    if (h.kind === 'event') { const e = state.calendar.events.find((x) => x.row === h.row); if (e) setForm({ kind: 'event', e }); }
    else if (h.kind === 'activity') { const a = state.calendar.activities.find((x) => x.row === h.row); if (a) setForm({ kind: 'activity', a }); }
  };
  const weekOf = (name: string) => state ? daysFrom(state.calendar, state.members, today, 7).flatMap((d) => forPerson(d.items, name)).slice(0, 3).map((h) => h.what) : [];
  // The facts say only what there is (p15 packs-life, 4 Nov 2026, "empty states that say nothing go"): zero parts
  // drop out, and with nothing at all the facts go away instead of reading "0 events · 0 people · 0 rewards on track".
  const parts: string[] = [];
  if (state && count) parts.push(`${count} event${count === 1 ? '' : 's'}`);
  if (state && state.members.length) parts.push(`${state.members.length} ${state.members.length === 1 ? 'person' : 'people'}`);
  if (state && onTrack) parts.push(`${onTrack} reward${onTrack === 1 ? '' : 's'} on track`);
  const facts = parts.length ? [{ k: 'Week ahead', v: parts.join(' · ') }] : [];
  return (
    <PackPage label="Family">
      <PackHead glyph="●" tint="green" title="Family" lead="Who is where, milestones, rewards, papers and albums."
        actions={<><AddMenu onPick={setForm} onAlbum={() => newAlbum(mem ?? null)} /><MoreButton label="More for Family" onOpen={(el) => moreMenu(el, state, mem ?? null)} /></>} />
      {state && <PageProps facts={facts} />}
      {state && !state.members.length && !count && <FillsLine id="family" />}
      {failed && !state && <EmptyState size="panel" icon="warning" title="Family couldn’t be read" line={failed} />}
      {!state && !failed && <p className="vsub">Reading your family’s notes…</p>}
      {state && state.members.length > 0 && (
        <div className="chips" role="group" aria-label="Show one person" style={{ marginTop: 12 }}>
          <button type="button" className={`chip${who === null ? ' on' : ''}`} aria-pressed={who === null} onClick={() => setWho(null)}>Everyone</button>
          {state.members.map((m) => <button key={m.path} type="button" className={`chip${who === m.name ? ' on' : ''}`} aria-pressed={who === m.name} onClick={() => setWho(who === m.name ? null : m.name)}>{m.name}</button>)}
        </div>
      )}
      {state && calOn && (
        <Section label="Week ahead">
          <div className="w3b-week" role="list" aria-label="The week, day by day">
            {days.map((d) => (
              <div key={d.day} role="listitem" className={`w3b-day${d.day === today ? ' is-today' : ''}`}>
                <b>{d.day === today ? 'Today' : dayWords(d.day, today).replace(/ \d+ \w+$/, '')} {d.day.slice(8).replace(/^0/, '')}</b>
                {d.items.map((h, i) => <HappeningBlock key={`${h.kind}-${h.row ?? i}-${i}`} h={h} members={state.members} onOpen={() => openHappening(h)} />)}
                {!d.items.length && <span className="w3b-free">Free</span>}
                {canEdit && <button type="button" className="w3b-evt slate" aria-label={`Add an event on ${dayWords(d.day, today)}`} onClick={() => setForm({ kind: 'event', date: d.day })}>+ Add</button>}
              </div>
            ))}
          </div>
        </Section>
      )}
      {state && (
        <div className="w3b-cols">
          <div>
            <Section label="Each person" action={canEdit ? <button type="button" className="btn quiet" onClick={() => setForm({ kind: 'member' })}>Add someone</button> : undefined}>
              {/* Bare when there is nothing but the line (t254); the rows keep their card. */}
              {!state.members.length ? (
                <p className="vsub" style={{ padding: '9px 0' }}>No one yet. Add each person once: their colour marks them on the week.</p>
              ) : (
              <div className="card" style={{ padding: '6px 20px' }}>
                {state.members.map((m) => {
                  // Week words and birthday worked out first (W5-24): mixing them in one || ?: threw on no birth date.
                  const week = weekOf(m.name).join(' · ');
                  const bday = nextBirthday(m.born, today);
                  return (
                  <button key={m.path} type="button" className="trow" style={{ width: '100%', background: 'none', border: 0, cursor: 'pointer', font: 'inherit', textAlign: 'left', color: 'var(--text)' }} onClick={() => openMember(m.path)} title={`Open ${m.name}’s page`}>
                    <i className={`miniava ${tintOf(m.colour)}`} aria-hidden="true">{m.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('')}</i>
                    <span className="t clip" style={{ flex: 'none' }}>{m.name}</span>
                    <span className="meta clip" style={{ marginLeft: 'auto' }}>{week || (bday ? `Birthday ${dayWords(bday.day, today)}` : m.relation || '')}</span>
                  </button>
                  );
                })}
              </div>
              )}
            </Section>
          </div>
          {msOn && (
            <div>
              <Section label="Milestones" action={canEdit ? <button type="button" className="btn quiet" onClick={() => setForm({ kind: 'milestone' })}>Keep one</button> : undefined}>
                {/* Bare when there is nothing but the line (t254); the rows keep their card. */}
                {!recent.length && !(rwOn && state.rewards.length) ? (
                  <p className="vsub" style={{ padding: '9px 0' }}>Firsts, awards and big moments, by person and day.</p>
                ) : (
                <div className="card" style={{ padding: '6px 20px' }}>
                  {recent.map((m) => (
                    <button key={m.row} type="button" className="trow" style={{ width: '100%', background: 'none', border: 0, font: 'inherit', textAlign: 'left', color: 'var(--text)', cursor: canEdit ? 'pointer' : 'default' }} disabled={!canEdit} onClick={() => setForm({ kind: 'milestone', m })} title={canEdit ? 'Click to change it' : undefined}>
                      <span className="check done" aria-hidden="true">✓</span>
                      <span className="t clip-2">{m.who.length ? `${m.who.join(', ')}: ${m.what}` : m.what}</span>
                      <span className="meta" style={{ marginLeft: 'auto' }}>{dayWords(m.date, today)}</span>
                    </button>
                  ))}
                  {rwOn && state.rewards.slice(0, 3).map((r) => (
                    <button key={r.path} type="button" className="trow" style={{ width: '100%', background: 'none', border: 0, cursor: 'pointer', font: 'inherit', textAlign: 'left', color: 'var(--text)' }} onClick={() => openMember(state.members.find((m) => m.name.toLowerCase() === r.who.toLowerCase())?.path ?? r.path)} title={`Open ${r.who}’s rewards`}>
                      <span className="t clip" style={{ fontWeight: 600 }}>Reward: {r.who ? `${firstOf(r.who)} ${r.habit.toLowerCase()}` : r.title}</span>
                      <span className="meta" style={{ marginLeft: 'auto' }}>{r.streak.next ? `${r.streak.current} of ${plural(r.streak.next.at, 'day')}` : `${plural(r.streak.current, 'day')} in a row`}</span>
                    </button>
                  ))}
                </div>
                )}
              </Section>
            </div>
          )}
        </div>
      )}
      {state && docsOn && state.members.length > 0 && (
        <Section label="Papers" action={<button type="button" className="btn quiet" onClick={() => A.revealInExplorer(`${state.folder}/Files`)}>Show the folder</button>}>
          <div className="card" style={{ padding: '6px 20px' }}>
            {state.members.flatMap((m) => (state.documents[m.path] ?? []).map((d) => ({ m, d }))).slice(0, 6).map(({ m, d }) => (
              <div key={d.path} className="trow">
                <span className="t clip">▤ {d.name}</span>
                <span className="meta clip">{m.name}{d.expires ? (d.expires < today ? ` · ran out ${dayWords(d.expires, today)}` : ` · runs to ${dayWords(d.expires, today)}`) : ''}</span>
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                  <button type="button" className="btn quiet" onClick={() => A.openPath(d.path)}>Open</button>
                  {canEdit && <button type="button" className="btn quiet" aria-label={`Delete ${d.name} to the Bin`} title="Delete to the Bin" onClick={() => void trashRecord(d.path)}>Delete</button>}
                </span>
              </div>
            ))}
            {!state.members.some((m) => (state.documents[m.path] ?? []).length) && <p className="vsub" style={{ padding: '9px 0' }}>No papers yet. Drop files onto a member’s card, or link them there.</p>}
          </div>
        </Section>
      )}
      {state && albumsOn && (
        <Section label="Albums" action={<>{(mem?.albums.length ?? 0) > 6 && <button type="button" className="btn quiet" onClick={() => openModule('family', 'albums')}>Every album</button>}{canEdit && <button type="button" className="btn quiet" onClick={() => newAlbum(mem ?? null)}>New album</button>}</>}>
          {!!state.legacy.length && (
            <div className="callout amber" style={{ marginBottom: 12 }}>
              <span>{state.legacy.length === 1 ? '1 album is' : `${state.legacy.length} albums are`} still only in Family’s old album folders. Move them into Family’s albums and they show here too.</span>
              {canEdit && <button type="button" className="btn" style={{ marginLeft: 'auto', flex: 'none' }} onClick={() => void window.nv.modules.family.migrateAlbums()}>Move into Family’s albums</button>}
            </div>
          )}
          <div className="card" style={{ padding: '6px 20px' }}>
            {!mem && <p className="vsub" style={{ padding: '9px 0' }}>Reading your albums…</p>}
            {mem && !mem.albums.length && <p className="vsub" style={{ padding: '9px 0' }}>No albums yet. Make one for an event, a trip or a person.</p>}
            {(mem?.albums ?? []).slice(0, 6).map((a) => (
              <div key={a.path} className="trow">
                <button type="button" style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer', display: 'grid', placeItems: 'center' }} onClick={() => openAlbum(a.path)} title={`Open ${a.name}`} aria-label={`Open ${a.name}`}>
                  <Cover cover={a.cover} />
                </button>
                <button type="button" className="t clip" style={{ background: 'none', border: 0, cursor: 'pointer', font: 'inherit', textAlign: 'left', color: 'var(--text)', fontSize: 15 }} onClick={() => openAlbum(a.path)}>{a.name}</button>
                <span className="meta" style={{ marginLeft: 'auto' }}>{[a.kind, span(a), plural(a.photos.length, 'photo')].filter(Boolean).join(' · ')}</span>
              </div>
            ))}
          </div>
        </Section>
      )}
      {state && <HomeCard pack="Family today" glyph="●" tint="green" title={todayLine(state, today)} meta={count ? `${count} events this week` : ''} />}
      {form && state && (
        <FormDialog title="Family" onDone={() => setForm(null)}>
          {form.kind === 'event' && <EventForm members={state.members} initial={form.e} date={form.date} onDone={() => setForm(null)} />}
          {form.kind === 'activity' && <ActivityForm members={state.members} initial={form.a} onDone={() => setForm(null)} />}
          {form.kind === 'milestone' && <MilestoneForm members={state.members} initial={form.m} onDone={() => setForm(null)} />}
          {form.kind === 'member' && <MemberForm initial={form.m} used={state.members.map((m) => m.colour)} onDone={() => setForm(null)} />}
          {form.kind === 'reward' && <RewardForm members={state.members} initial={form.r} onDone={() => setForm(null)} />}
        </FormDialog>
      )}
    </PackPage>
  );
}

function todayLine(state: FamilyState, today: string): string {
  const items = daysFrom(state.calendar, state.members, today, 1)[0]?.items ?? [];
  if (!items.length) return 'Nothing on today';
  return `Today: ${items.slice(0, 3).map((h) => `${h.what}${h.who.length ? ` ${firstOf(h.who[0])}` : ''}`).join(' · ')}`;
}

// ── A person's page ──────────────────────────────────────────────────────────────────────────────────────────────

export function MemberDetail({ path }: { path: string }) {
  const { state } = useFamily();
  const canEdit = useCanEdit();
  const [form, setForm] = useState<FormKind>(null);
  const [editingTracker, setEditingTracker] = useState<string | null>(null);
  const today = todayIso();
  const m = state?.members.find((x) => x.path === path) ?? null;
  const mine = useMemo(() => (state && m ? daysFrom(state.calendar, state.members, today, 7).flatMap((d) => forPerson(d.items, m.name)) : []), [state, m, today]);
  const milestones = useMemo(() => (state && m ? [...state.calendar.milestones].filter((x) => x.who.some((w) => w.toLowerCase() === m.name.toLowerCase())).sort((a, b) => b.date.localeCompare(a.date)) : []), [state, m]);
  const trackers = useMemo(() => (state && m ? state.rewards.filter((r) => r.who.toLowerCase() === m.name.toLowerCase()) : []), [state, m]);
  const docs = (state && m ? state.documents[m.path] ?? [] : []);
  const albums = useMemo(() => (state && m ? state.albums.filter((a) => a.name.toLowerCase().includes(m.name.toLowerCase()) || a.name.toLowerCase().includes(firstOf(m.name).toLowerCase())) : []), [state, m]);
  if (!state) return <PackPage label="Family"><p className="vsub">Reading your family’s notes…</p></PackPage>;
  if (!m) return <PackPage label="Family"><EmptyState icon="people" title="They aren’t here any more" line="Their card may have been moved or deleted." action={{ label: 'Family', icon: 'back', run: () => openModule('family') }} /></PackPage>;
  const age = ageOn(m.born, today);
  const bday = nextBirthday(m.born, today);
  const acts = state.calendar.activities.filter((a) => a.who.some((w) => w.toLowerCase() === m.name.toLowerCase()));
  const sub = [m.relation, m.school, acts.slice(0, 2).map((a) => `${a.what} ${a.dayWords}`).join(', ')].filter(Boolean).join('. ') || 'Family-private · kept as notes';
  const rewardLine = trackers.length ? trackers.map((r) => r.habit + ': ' + (r.streak.next ? r.streak.current + ' of ' + r.streak.next.at + ' days' : r.streak.current + ' days in a row') + (r.earned ? ', reward earned' : '')).join(' · ') : 'No trackers yet';
  const weekLine = mine.length ? mine.slice(0, 3).map((h) => `${h.what} ${dayWords(h.day, today).split(' ')[0]}`).join(' · ') : 'Nothing on this week';
  const copyLink = () => { void navigator.clipboard.writeText(writeLink(m.path, undefined)).then(() => toast('A link to their card is on the clipboard.')); };
  return (
    <PackPage label={m.name}>
      <PackHead tint={tintOf(m.colour)} icon={<span className={`w3b-ava ${tintOf(m.colour)}`} aria-hidden="true">{m.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('')}</span>} title={m.name} sharePath={m.path} lead={<>{sub}{age !== null ? ` · ${age}` : ''}{bday ? (bday.in === 0 ? ` · Birthday today (${bday.age})` : ` · Turns ${bday.age} ${dayWords(bday.day, today)}`) : ''}</>}
        actions={<><button type="button" className="btn" onClick={() => A.openPath(m.path)}>Open their card</button><MoreButton label={`More for ${m.name}`} onOpen={(el) => openMenu(el, [
          { label: 'Change their details…', icon: 'pencil', disabled: !canEdit, run: () => setForm({ kind: 'member', m }) },
          { label: 'Copy link', icon: 'link', run: copyLink },
          { separator: true },
          { label: deleteToBin('their card'), icon: 'trash', danger: true, disabled: !canEdit, run: () => void trashRecord(m.path).then((ok) => ok && openModule('family')) },
        ])} /></>} />
      <PageProps facts={[{ k: 'This week', v: weekLine }, { k: 'Reward', v: trackers.length ? <>{rewardLine} <span className="pill green">{trackers.some((r) => r.earned) ? 'reward earned' : 'on track'}</span></> : rewardLine }]} />
      {/* No wrapper box (p15 packs-life): the page settles its own sections to the title's edge. */}
      <>
        <Section label="Milestones" action={canEdit ? <button type="button" className="btn quiet" onClick={() => setForm({ kind: 'milestone' })}>Keep one</button> : undefined}>
          {/* Bare when there is nothing but the line (t258, the shared RowsCard); the rows keep their card. */}
          <RowsCard empty={!milestones.length} words={<>No milestones for {firstOf(m.name)} yet.</>}>
            {milestones.map((x) => (
              <button key={x.row} type="button" className="trow" style={{ width: '100%', background: 'none', border: 0, font: 'inherit', textAlign: 'left', color: 'var(--text)', cursor: canEdit ? 'pointer' : 'default' }} disabled={!canEdit} onClick={() => setForm({ kind: 'milestone', m: x })} title={canEdit ? 'Click to change it' : undefined}>
                <span className="check done" aria-hidden="true">✓</span>
                <span className="t clip">{x.what}</span>
                <span className="meta" style={{ marginLeft: 'auto' }}>{dayWords(x.date, today)}</span>
              </button>
            ))}
          </RowsCard>
        </Section>
        {!!trackers.length && (
          <Section label="Reward trackers" action={canEdit ? <button type="button" className="btn quiet" onClick={() => setForm({ kind: 'reward' })}>New tracker</button> : undefined}>
            <ul style={{ listStyle: 'none', display: 'grid', gap: 12, padding: 0 }}>
              {trackers.map((r) => editingTracker === r.path ? (
                <li key={r.path} className="card"><RewardForm members={state.members} initial={r} onDone={() => setEditingTracker(null)} /></li>
              ) : (
                <li key={r.path} className="card" style={{ listStyle: 'none' }}>
                  <div className="fy-reward-words" style={{ marginBottom: 8 }}>
                    <strong>{r.habit}</strong>
                    <span className="vsub"> · {r.streak.current} in a row · best {r.streak.best}</span>
                    <span style={{ float: 'right', display: 'flex', gap: 4 }}>
                      {r.earned && canEdit && <button type="button" className="btn pri" onClick={() => void window.nv.modules.family.claim(r.path, r.earned!.at)}>Give reward</button>}
                      {canEdit && <button type="button" className="btn quiet" aria-label="Change the rewards" onClick={() => setEditingTracker(r.path)}>Change</button>}
                      {canEdit && <button type="button" className="btn quiet" aria-label={`Delete ${r.habit} tracker to the Bin`} onClick={() => void trashRecord(r.path)}>Delete</button>}
                    </span>
                  </div>
                  <RewardCard r={r} members={state.members} canEdit={canEdit} onEdit={() => setEditingTracker(r.path)} />
                </li>
              ))}
            </ul>
          </Section>
        )}
        {!trackers.length && canEdit && (
          <Section label="Reward trackers" action={<button type="button" className="btn quiet" onClick={() => setForm({ kind: 'reward' })}>New tracker</button>}>
            {/* Bare, never a card (t254, 13 Nov 2026: one short line in a box is the empty space). */}
            <p className="vsub" style={{ padding: '9px 0' }}>Pick something done each day and the rewards along the way.</p>
          </Section>
        )}
        <Section label="Papers and albums">
          {/* Bare when there is nothing but the line (t254, 13 Nov 2026: one short line in a box is the
              empty space); the rows keep their card. */}
          {!docs.length && !albums.length ? (
            <p className="vsub" style={{ padding: '9px 0' }}>Nothing here yet. Files in {state.folder}/Files/{m.name}/ and links on their card show here.</p>
          ) : (
            <div className="card" style={{ padding: '6px 20px' }}>
              {docs.map((d) => (
                <div key={d.path} className="trow">
                  <span className="t clip">▤ {d.name}</span>
                  <span className="meta clip" style={{ marginLeft: 'auto' }}>{d.expires ? (d.expires < today ? `ran out ${dayWords(d.expires, today)}` : `runs to ${dayWords(d.expires, today)}`) : ''}</span>
                  <button type="button" className="btn quiet" onClick={() => A.openPath(d.path)}>Open</button>
                </div>
              ))}
              {albums.map((a) => (
                <div key={a.folder} className="trow">
                  <span className="t clip">◍ {a.name}</span>
                  <span className="meta" style={{ marginLeft: 'auto' }}>{a.photos.length === 1 ? '1 photo' : `${a.photos.length} photos`}</span>
                  <button type="button" className="btn quiet" onClick={() => openAlbum(a.folder)}>Open</button>
                </div>
              ))}
            </div>
          )}
        </Section>
        <AskFloat hint={`Ask about ${firstOf(m.name)}’s week…`} scope={m.path} />
      </>
      {form && (
        <FormDialog title={m.name} onDone={() => setForm(null)}>
          {form.kind === 'milestone' && <MilestoneForm members={state.members} initial={form.m} onDone={() => setForm(null)} />}
          {form.kind === 'member' && <MemberForm initial={form.m} used={state.members.map((x) => x.colour)} onDone={() => setForm(null)} />}
          {form.kind === 'reward' && <RewardForm members={state.members} initial={form.r} onDone={() => setForm(null)} />}
        </FormDialog>
      )}
    </PackPage>
  );
}

// ── One person's photos, one project ──────────────────────────────────────────────────────────────────────────────────

export function PersonDetail({ name }: { name: string }) {
  const canEdit = useCanEdit();
  const { data: m } = useWork<MemoriesView>('memories');
  if (!m) return <PackPage label="Family"><p className="vsub">Reading your albums…</p></PackPage>;
  const p = m.people.find((x) => x.name.toLowerCase() === name.toLowerCase());
  const photos = p?.photos ?? [];
  const albums = new Set(photos.map((x) => x.album)).size;
  return (
    <PackPage label={name}>
      <PackHead glyph="◍" tint="amber" title={name} lead={photos.length ? `${plural(photos.length, 'photo')} in ${plural(albums, 'album')}` : 'No photos of them yet'} />
      <PersonPage name={name} m={m} canEdit={canEdit} />
    </PackPage>
  );
}

export function CreativeDetail({ path }: { path: string }) {
  const canEdit = useCanEdit();
  const { data: m } = useWork<MemoriesView>('memories');
  if (!m) return <PackPage label="Family"><p className="vsub">Reading your albums…</p></PackPage>;
  const c = m.creative.find((x) => x.path === path);
  if (!c) return <PackPage label="Family"><EmptyState icon="image" title="It isn’t here any more" line="It may have been moved or deleted." action={{ label: 'Creative projects', icon: 'back', run: () => openModule('family', 'creative') }} /></PackPage>;
  return (
    <PackPage label={c.name}>
      <PackHead glyph="◍" tint="amber" title={c.name} lead={[c.kind, c.occasion, c.status !== 'Idea' ? c.status : ''].filter(Boolean).join(' · ')} />
      <CreativePage c={c} m={m} canEdit={canEdit} />
    </PackPage>
  );
}

/** Family's page switch: a person's page, an album's, one person's or one project's page, the previous layout's
 *  album tabs, the previous layout, else the new overview. */
export function familyPlace(tab: W.TabState): 'member' | 'album' | 'person' | 'creative' | 'rest' | 'classic' | 'overview' {
  const part = partOfTab(tab) ?? '';
  if (part.startsWith('member:')) return 'member';
  if (part.startsWith('album:')) return 'album';
  if (part.startsWith('person:')) return 'person';
  if (part.startsWith('creative:')) return 'creative';
  if (part === 'albums' || part === 'people' || part === 'creative') return 'rest';
  if (part === 'classic' || part.startsWith('classic:')) return 'classic';
  return 'overview';
}
export { memberPathOf };
/** The detail a family tab names (a person, an album, one person's photos, one project), if any. */
export const familyDetailOf = (tab: W.TabState): { kind: string; key: string } | null => {
  const part = partOfTab(tab) ?? '';
  const m = /^(member|album|person|creative):(.+)$/.exec(part);
  if (!m) return null;
  try { return { kind: m[1], key: decodeURIComponent(m[2]) }; } catch { return { kind: m[1], key: m[2] }; }
};
