// Health and Fitness (Wave 5, 24 Oct 2026; module 9 and the spec). One page with a part for each piece of the module
// that is switched on — Today (the check-in and the day at a glance), Training, Food and water, Sleep, Body, Habits,
// Appointments, Trends — and Settings. Everything comes from the encrypted health store on this PC
// (src/main/health-store.ts) and every value shown changes where it is.

import { checkinState, remindersDue, todayIso } from '../../../../shared/health';
import { moduleInfo, partOn } from '../../../../shared/life-modules';
import { EmptyState } from '../../components/EmptyState';
import { Icon } from '../../components/Icon';
import { openMenu } from '../../components/Menu';
import { openModal } from '../../state/modals';
import { moduleChanged, openModule, partOfTab, useModules } from '../../state/modules';
import { showError, toast } from '../../state/store';
import type * as W from '../../state/workspace';
import { PageHead } from '../../components/PageHead';
import { HealthDay } from './health/HealthDay';
import { HealthAppointments, HealthFood, HealthSettings } from './health/HealthMore';
import { HealthBody, HealthHabits, HealthSleep, HealthTrends } from './health/HealthTrack';
import { HealthTraining } from './health/HealthTraining';
import { healthNeeds } from '../../../../shared/module-purpose';
import { NeedsYou } from './NeedsYou';
import { ModuleTour } from './ModuleTour';
import { H, useHealth } from './health/useHealth';
import { CheckinDetail, HealthOverview, healthPlace } from './w3b/Health87';

type Part = 'today' | 'training' | 'food' | 'sleep' | 'body' | 'habits' | 'appointments' | 'trends' | 'settings';
const PARTS: { id: Part; label: string; needs?: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'training', label: 'Training', needs: 'training' },
  { id: 'food', label: 'Food and water', needs: 'food' },
  { id: 'sleep', label: 'Sleep', needs: 'sleep' },
  { id: 'body', label: 'Body', needs: 'body' },
  { id: 'habits', label: 'Habits', needs: 'habits' },
  { id: 'appointments', label: 'Appointments', needs: 'appointments' },
  { id: 'trends', label: 'Trends' },
  { id: 'settings', label: 'Settings' },
];

export function HealthClassic({ tab }: { tab: W.TabState }) {
  const { db, status, failed, act } = useHealth();
  const sw = useModules();
  const shown = PARTS.filter((p) => !p.needs || partOn(sw, 'health', p.needs));
  const asked = partOfTab(tab) as Part | undefined;
  const part: Part = shown.some((p) => p.id === asked) ? asked! : 'today';
  const today = todayIso();
  const due = db ? remindersDue(db, today).length : 0;
  const ci = db ? checkinState(db) : null;
  return (
    <div className="hl-shell">
      <div className="pv-page list hl-page">
        <div className="pv-inner hl-inner">
          {/* One page header for every module page (8.0 section D): PageHead, no icon-tile header. */}
          <PageHead
            icon="heart"
            title="Health"
            lead={<><Icon name="lock" size={11} /> On this PC only · encrypted · never sent to an assistant unless you ask{status?.words && status.words !== 'Nothing kept yet' ? ` · ${status.words.toLowerCase()}` : ''}{moduleInfo('health') && <ModuleTour module={moduleInfo('health')!} />}</>}
            actions={
              <button
                type="button"
                className="icon-button"
                title="More"
                aria-label="More for Health"
                onClick={(e) =>
                  openMenu(e.currentTarget, [
                    { label: 'Export a copy…', icon: 'download', run: () => void H().exportFile().then((f) => f && toast(`Exported to ${f}. That file isn’t encrypted: keep it somewhere safe.`), showError) },
                    { label: 'Export my data (CSV)…', icon: 'table', run: () => void H().exportCsv().then((f) => f && toast(`Exported to ${f}. That file isn’t encrypted: keep it somewhere safe.`), showError) },
                    { label: 'Bring back an export…', icon: 'history', run: () => void H().importFile().then((w) => { if (w) { toast(w); moduleChanged(); } }, showError) },
                    { separator: true },
                    { label: 'Who may read Health…', icon: 'lock', run: () => openModal({ kind: 'settings', section: 'privacy' }) },
                    { label: 'Health’s parts (Settings › Packs)…', icon: 'settings', run: () => openModal({ kind: 'settings', section: 'modules' }) },
                  ])
                }
              >
                <Icon name="more" size={16} />
              </button>
            }
          />
          <div className="segmented sx-parts hl-parts" role="tablist" aria-label="Health’s parts">
            {shown.map((p) => (
              <button key={p.id} role="tab" aria-selected={part === p.id} className={part === p.id ? 'active' : ''} onClick={() => openModule('health', p.id)}>
                {p.label}
                {p.id === 'today' && ci?.due ? <em className="hl-dot" aria-label="the check-in is due">•</em> : null}
                {p.id === 'appointments' && due ? <em>{due}</em> : null}
              </button>
            ))}
          </div>
          {failed && !db && <EmptyState size="panel" icon="lock" title="Your health records couldn’t be opened" line={failed} />}
          {!db && !failed && <p className="hl-faint hl-loading">Opening your health records…</p>}
          {db && (
            <div className="hl-body" key={part}>
              {part === 'today' && <><NeedsYou cards={healthNeeds((partOn(sw, 'health', 'appointments') ? remindersDue(db, today) : []).map((a) => ({ title: a.why ? `${a.who}: ${a.why}` : a.who, date: a.day })), !!ci?.due, db.measures.filter((mm) => mm.group === 'habit' && mm.kind === 'yesno').map((mm) => ({ name: mm.name, doneToday: db.entries.some((e) => e.day === today && e.measure === mm.id && e.yes) })), today)} today={today} onAction={() => openModule('health', 'today')} /><HealthDay db={db} act={act} /></>}
              {part === 'training' && <HealthTraining db={db} act={act} />}
              {part === 'food' && <HealthFood db={db} act={act} />}
              {part === 'sleep' && <HealthSleep db={db} act={act} />}
              {part === 'body' && <HealthBody db={db} act={act} />}
              {part === 'habits' && <HealthHabits db={db} act={act} />}
              {part === 'appointments' && <HealthAppointments db={db} act={act} />}
              {part === 'trends' && <HealthTrends db={db} act={act} />}
              {part === 'settings' && <HealthSettings db={db} act={act} status={status} />}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── The 8.7 page (30 Oct 2026): the new overview and check-in, the rest as before ─────────────────────────────

export function HealthPage({ tab }: { tab: W.TabState }) {
  const place = healthPlace(tab);
  if (place === 'overview') return <HealthOverview tab={tab} />;
  if (place === 'checkin') return <CheckinDetail tab={tab} />;
  if (place === 'classic') { const suffix = (partOfTab(tab) ?? '').startsWith('classic:') ? (partOfTab(tab) ?? '').slice(8) : 'today'; return <HealthClassic tab={{ ...tab, path: `module:health#${suffix}` }} />; }
  return <HealthClassic tab={tab} />;
}
