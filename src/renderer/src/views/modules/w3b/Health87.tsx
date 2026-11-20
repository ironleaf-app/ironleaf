// Health's 8.7 pages (30 Oct 2026): the overview (health.html: the streak, the week in numbers, food and water, visits,
// the home card) and today's check-in (health-checkin.html: each answer saved as it is given, Done only closes it).
// Every ability the old Today had lives here: the check-in answered and its streak kept, water stepped, meals and sleep
// and training seen and opened, habits ticked, visits booked and opened. Training, food, sleep, body, habits,
// appointments, trends and settings keep the previous layout. One primary button per screen.

import { useMemo } from 'react';
import { addDays, checkinState, dayWords, entryOn, foodOn, sessionsInWeek, timeWords, todayIso, upcoming, valueWords, type HealthDb, type Measure } from '../../../../../shared/health';
import { partOn } from '../../../../../shared/life-modules';
import { openMenu } from '../../../components/Menu';
import { openTour } from '../../../state/moduleFills';
import { openModule, partOfTab, useModules } from '../../../state/modules';
import { showError, toast } from '../../../state/store';
import type * as W from '../../../state/workspace';
import { Answer } from '../health/bits';
import { H, useHealth } from '../health/useHealth';
import { FillsLine, HomeCard, MoreButton, PackHead, PackPage, PageProps, Section, useCanEdit, FULL_DETAILS_LABEL } from './W3b';

const GROUP_LABEL: Record<string, string> = { sleep: 'Sleep', food: 'Food and water', body: 'Body', training: 'Move', checkin: 'Today', habit: 'Habits' };

function moreMenu(el: HTMLElement, db: HealthDb | null) {
  void db;
  openMenu(el, [
    { label: 'Training', icon: 'bolt', run: () => openModule('health', 'training') },
    { label: 'Food and water', icon: 'receipt', run: () => openModule('health', 'food') },
    { label: 'Sleep', icon: 'clock', run: () => openModule('health', 'sleep') },
    { label: 'Body', icon: 'person', run: () => openModule('health', 'body') },
    { label: 'Habits', icon: 'flag', run: () => openModule('health', 'habits') },
    { label: 'Appointments', icon: 'calendar', run: () => openModule('health', 'appointments') },
    { label: 'Trends', icon: 'chart', run: () => openModule('health', 'trends') },
    { label: 'Health settings', icon: 'settings', run: () => openModule('health', 'settings') },
    { label: 'Export my data (CSV)…', icon: 'download', run: () => void H().exportCsv().then((f) => f && toast(`Exported to ${f}. That file isn’t encrypted: keep it somewhere safe.`), showError) },
    { label: 'Show me around Health', icon: 'sparkle', run: () => openTour('health') },
    { separator: true },
    { label: FULL_DETAILS_LABEL, icon: 'history', run: () => openModule('health', 'classic') },
  ]);
}

export function HealthOverview({ tab }: { tab: W.TabState }) {
  void tab;
  const { db, failed, act } = useHealth();
  const canEdit = useCanEdit();
  const sw = useModules();
  const on = (p: string) => partOn(sw, 'health', p);
  const today = todayIso();
  const ci = db ? checkinState(db) : null;
  const water = db?.measures.find((m) => m.id === 'water' && !m.archived);
  const sleep = db?.measures.find((m) => m.id === 'sleep' && !m.archived);
  const weight = db?.measures.find((m) => m.id === 'weight' && !m.archived);
  const food = db ? foodOn(db, today) : null;
  const visits = useMemo(() => (db ? upcoming(db, today, 60).slice(0, 4) : []), [db, today]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(today, i - 6)), [today]);
  const waterN = (db && water && entryOn(db, 'water', today)?.n) ?? 0;
  const sleepE = db && sleep ? entryOn(db, 'sleep', today) : undefined;
  const weightE = db && weight ? entryOn(db, 'weight', today) : undefined;
  const dayNum = ci ? ci.streak.current + (ci.done ? 0 : 1) : 1;
  return (
    <PackPage label="Health">
      <PackHead glyph="♥" tint="green" title="Health" lead="Check-ins, training, meals, sleep and visits. Locked on this PC."
        actions={<>{on('checkin') && <button type="button" className="btn pri" onClick={() => openModule('health', 'checkin')}>Check in today</button>}<MoreButton label="More for Health" onOpen={(el) => moreMenu(el, db)} /></>} />
      {db && ci && <PageProps facts={[{ k: 'Streak', v: ci.streak.current ? (ci.streak.current >= ci.streak.best ? <>{ci.streak.current} {ci.streak.current === 1 ? 'day' : 'days'} checked in <span className="pill green">best yet</span></> : `${ci.streak.current} ${ci.streak.current === 1 ? 'day' : 'days'} checked in · best ${ci.streak.best}`) : ci.streak.best ? `Not checked in today · best ${ci.streak.best}` : 'Check in to start a streak' }]} />}
      {db && !db.sessions.length && !db.entries.length && !db.meals.length && !db.appointments.length && <FillsLine id="health" />}
      {failed && !db && <p className="vsub">{failed}</p>}
      {!db && !failed && <p className="vsub">Opening your health records…</p>}
      {db && (
        <Section label="Week in numbers">
          <div className="w3b-week" role="list" aria-label="The last seven days">
            {days.map((d) => {
              const sessions = db.sessions.filter((s) => s.day === d);
              const sl = sleep ? entryOn(db, 'sleep', d) : undefined;
              return (
                <div key={d} role="listitem" className={`w3b-day${d === today ? ' is-today' : ''}`}>
                  <b>{d === today ? 'Today' : `${dayWords(d, today).split(' ')[0]} ${Number(d.slice(8))}`}</b>
                  {sessions.length ? sessions.slice(0, 2).map((s) => <span key={s.id} className="w3b-evt green" title={s.title}>{s.title}</span>) : <span className="w3b-free">{db.sessions.length ? 'rest' : '–'}</span>}
                  {sl && sleep && <span className="w3b-evt slate" title={`Sleep: ${valueWords(sleep, sl)}`}>{valueWords(sleep, sl)}</span>}
                </div>
              );
            })}
          </div>
        </Section>
      )}
      {db && on('food') && (
        <Section label="Today · food and water" action={<button type="button" className="btn quiet" onClick={() => openModule('health', 'food')}>Food and water</button>}>
          <div className="w3b-stats">
            <div className="w3b-stat"><b>{waterN}{water?.daily ? ` / ${water.daily}` : ''}</b><span>Water (glasses)</span>
              {canEdit && water && <span style={{ display: 'flex', gap: 4, marginTop: 6 }}><button type="button" className="btn quiet" style={{ height: 28 }} aria-label="One glass less" disabled={!waterN} onClick={() => void act(H().entry('water', today, waterN - 1 <= 0 ? null : waterN - 1))}>−</button><button type="button" className="btn quiet" style={{ height: 28 }} aria-label="One more glass" onClick={() => void act(H().entry('water', today, waterN + 1))}>+</button></span>}
            </div>
            <div className="w3b-stat"><b>{(food?.meals.length ?? 0) > 0 ? food!.meals.length : '–'}</b><span>Meals logged</span>
              <span style={{ display: 'block', marginTop: 6, fontSize: 13, color: 'var(--text-muted)' }}>{food?.kcal ? `${food.kcal.toLocaleString('en-AU')} kcal${db.targets.kcal ? ` of ${db.targets.kcal.toLocaleString('en-AU')}` : ''}` : 'No figures yet'}</span>
            </div>
            <div className="w3b-stat"><b>{(() => { const n = sessionsInWeek(db, today).length; const goal = db.targets.sessionsPerWeek; return n ? `${n}${goal ? ` / ${goal}` : ''}` : goal && db.sessions.length ? `${goal} to do` : '–'; })()}</b><span>Training this week</span></div>
          </div>
        </Section>
      )}
      {db && on('appointments') && (
        <Section label="Visits" action={<button type="button" className="btn quiet" onClick={() => openModule('health', 'appointments')}>Appointments</button>}>
          {/* Bare when there is nothing but the line (t254); the rows keep their card. */}
          {!visits.length ? (
            <p className="vsub" style={{ padding: '9px 0' }}>None booked. Book one to be reminded before it.</p>
          ) : (
          <div className="card" style={{ padding: '6px 20px' }}>
            {visits.map((a) => (
              <div key={a.id} className="trow">
                <button type="button" className="t clip" style={{ background: 'none', border: 0, cursor: 'pointer', font: 'inherit', textAlign: 'left', color: 'var(--text)', fontSize: 15 }} onClick={() => openModule('health', 'appointments')} title="Open appointments">{a.who}{a.why ? `, ${a.why}` : ''}</button>
                <span className="meta" style={{ marginLeft: 'auto' }}>{dayWords(a.day, today)}{a.time ? ` at ${timeWords(a.time)}` : ''}</span>
              </div>
            ))}
          </div>
          )}
        </Section>
      )}
      {db && ci && <HomeCard pack="Check in" glyph="♥" tint="green" title={ci.done ? `Day ${dayNum} saved, streak kept` : `Day ${dayNum}: a few quick answers`} meta={[sleepE && sleep ? `sleep ${valueWords(sleep, sleepE)}` : '', weightE && weight ? `weight ${valueWords(weight, weightE)}` : ''].filter(Boolean).join(' · ') || 'sleep, water, weight'} />}
    </PackPage>
  );
}

// ── Today's check-in ─────────────────────────────────────────────────────────────────────────────────────────────

export function CheckinDetail({ tab }: { tab: W.TabState }) {
  void tab;
  const { db, act } = useHealth();
  const today = todayIso();
  const ci = db ? checkinState(db) : null;
  const asked = useMemo(() => (db ? db.checkin.measures.map((id) => db.measures.find((m) => m.id === id)).filter((m): m is Measure => !!m && !m.archived) : []), [db]);
  const groups = useMemo(() => {
    const by = new Map<string, Measure[]>();
    for (const m of asked) { const g = by.get(m.group) ?? []; g.push(m); by.set(m.group, g); }
    return [...by.entries()];
  }, [asked]);
  const weight = db?.measures.find((m) => m.id === 'weight' && !m.archived);
  const delta = useMemo(() => {
    if (!db || !weight) return '';
    const month = addDays(today, -30);
    const entries = db.entries.filter((e) => e.measure === 'weight' && e.n !== undefined && e.day >= month).sort((a, b) => a.day.localeCompare(b.day));
    if (entries.length < 2) return '';
    const d = Math.round((entries[entries.length - 1].n! - entries[0].n!) * 10) / 10;
    if (!d) return 'unchanged this month';
    return `${d > 0 ? 'up' : 'down'} ${Math.abs(d)} kg this month`;
  }, [db, weight, today]);
  if (!db || !ci) return <PackPage label="Health"><p className="vsub">Opening your health records…</p></PackPage>;
  const dayNum = ci.streak.current + (ci.done ? 0 : 1);
  const answered = asked.filter((m) => entryOn(db, m.id, today)).length;
  const dateLine = `${dayWords(today, addDays(today, -1))}`;
  return (
    <PackPage label="Today's check-in">
      <PackHead glyph="♥" tint="green" title="Today’s check-in" lead={`${dateLine}. Day ${dayNum} of your streak.`}
        actions={<><button type="button" className="btn pri" onClick={() => openModule('health')}>Done</button><MoreButton label="More for the check-in" onOpen={(el) => moreMenu(el, db)} /></>} />
      <PageProps facts={[{ k: 'Answered', v: answered ? `${answered} of ${asked.length}` : `${asked.length} to answer` }, ...(weight && delta ? [{ k: 'Weight', v: delta }] : [])]} />
      {!asked.length && <div className="card" style={{ marginTop: 14 }}><p className="vsub">The check-in asks nothing yet.</p><p style={{ marginTop: 8 }}><button type="button" className="btn" onClick={() => openModule('health', 'settings')}>Choose its questions</button></p></div>}
      {groups.map(([group, measures]) => (
        <Section key={group} label={GROUP_LABEL[group] ?? (group[0]!.toUpperCase() + group.slice(1))}>
          <div className="card" style={{ padding: '6px 20px' }}>
            {measures.map((m) => (
              <div key={m.id} className="trow" style={{ alignItems: 'flex-start' }}>
                <span className="t" style={{ paddingTop: 6 }}>{m.name}{m.kind === 'scale' ? ` (${m.min ?? 1} to ${m.max ?? 10})` : ''}{m.daily !== undefined ? ` · goal ${m.daily}` : ''}</span>
                <span style={{ marginLeft: 'auto' }}>
                  <Answer m={m} entry={entryOn(db, m.id, today)} onSave={(v) => void act(H().entry(m.id, today, v))} />
                </span>
              </div>
            ))}
          </div>
        </Section>
      ))}
      {db && <HomeCard pack="Check in" glyph="♥" tint="green" title={ci.done ? `Day ${dayNum} saved, streak kept` : answered ? `Day ${dayNum}: ${answered} of ${asked.length} answered` : `Day ${dayNum}: ${asked.length} to answer`} meta="training plan: open Training" />}
    </PackPage>
  );
}

/** Health's page switch: the new overview and check-in, the previous layout, the rest as before. */
export function healthPlace(tab: W.TabState): 'overview' | 'checkin' | 'classic' | 'rest' {
  const part = partOfTab(tab) ?? 'overview';
  if (part === 'classic' || part.startsWith('classic:')) return 'classic';
  if (part === 'checkin') return 'checkin';
  if (part === 'overview' || part === '' || part === 'today') return 'overview';
  return 'rest';
}
