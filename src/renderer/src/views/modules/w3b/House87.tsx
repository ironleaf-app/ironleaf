// House's 8.7 pages (30 Oct 2026): the overview (house.html: rooms, upkeep due, the seasonal starter pack, the home
// card) and an appliance's page (house-appliance.html: manuals, service history, its jobs, what to do when it breaks).
// Every ability the old overview had lives here: rooms and jobs seen and done where shown, warranties watched, starter
// packs added at once, appliances added and deleted to the Bin. The house's tables, the job's page and the record
// views keep the previous layout. One primary button per screen.

import { useMemo } from 'react';
import { APPLIANCE_KINDS, APPLIANCE_STATUSES, HOUSE } from '../../../../../shared/personal-modules';
import { SEASONAL_PACKS, currentSeasonalPack, jobWords, planSeasonalPack, warrantyChecklist, type Appliance, type Job } from '../../../../../shared/house';
import { partOn } from '../../../../../shared/life-modules';
import { openMenu } from '../../../components/Menu';
import { writeLink } from '../../../lib/links';
import * as A from '../../../state/actions';
import { openTour } from '../../../state/moduleFills';
import { openModule, partOfTab, useModules } from '../../../state/modules';
import { toast } from '../../../state/store';
import { useWork, workDid } from '../../../state/workModules';
import type * as W from '../../../state/workspace';
import { dayText } from '../work/WorkShell';
import { addHistory, houseOptions, jobTone, markDone, newAppliance, newHome, newJob, openAppliance, openJob, save, warrantyTone, type HouseView } from '../personal/HousePage';
import { caller, fileName, Inline, keepFiles, money, plural } from '../personal/PersonalParts';
import { PackReadState, AskFloat, FillsLine, HomeCard, MoreButton, PackHead, PackPage, PageProps, RowsCard, Section, trashRecord, useCanEdit, FULL_DETAILS_LABEL , EDIT_DETAILS_LABEL } from './W3b';
import { deleteToBin } from '../../../lib/removeWords';

const MOD = 'house';
const call = caller(MOD);
const jobTint = (j: Job) => (jobTone(j) === 'bad' ? 'red' : jobTone(j) === 'warn' ? 'amber' : jobTone(j) === 'ok' ? 'green' : 'slate') as 'slate' | 'green' | 'amber' | 'red' | 'blue';
const warrTint = (a: Appliance) => (warrantyTone(a) === 'bad' ? 'red' : warrantyTone(a) === 'warn' ? 'amber' : warrantyTone(a) === 'ok' ? 'green' : 'slate') as 'slate' | 'green' | 'amber' | 'red' | 'blue';
/** A day without its weekday ("4 Feb 2027"): for short pill words. */
const nodow = (iso: string) => dayText(iso).replace(/^\S+ /, '');

function JobRows({ jobs, m, canEdit }: { jobs: Job[]; m: HouseView; canEdit: boolean }) {
  return (
    <>
      {jobs.map((j) => (
        <div key={j.path} className="trow">
          <button type="button" className="t clip" style={{ background: 'none', border: 0, cursor: 'pointer', font: 'inherit', textAlign: 'left', color: 'var(--text)', fontSize: 15 }} onClick={() => openJob(j.path)} title="Open the job">{j.name}</button>
          <span className="meta clip" style={{ marginLeft: 'auto' }}>{[j.appliance || j.room, jobWords(j, m.today)].filter(Boolean).join(' · ')}</span>
          <span className={`tag ${jobTint(j)}`}>{j.state === 'Overdue' ? 'Overdue' : j.nextDue ? dayText(j.nextDue) : j.state}</span>
          {j.state !== 'Paused' && j.state !== 'Done' && canEdit && <button type="button" className="btn quiet" onClick={() => markDone(j, m, true)} title="Done today: its next day moves on">Done</button>}
          {canEdit && <button type="button" className="btn quiet" aria-label={`Delete ${j.name} to the Bin`} title="Delete to the Bin" onClick={() => void trashRecord(j.path)}>Delete</button>}
        </div>
      ))}
    </>
  );
}

export function HouseOverview({ tab }: { tab: W.TabState }) {
  void tab;
  const canEdit = useCanEdit();
  const modules = useModules();
  const maintOn = partOn(modules, MOD, 'maintenance');
  const warrOn = partOn(modules, MOD, 'warranties');
  const { data: m, error } = useWork<HouseView>(MOD);
  const rooms = useMemo(() => {
    const names = [...new Set((m?.homes ?? []).flatMap((h) => h.rooms.map((r) => r.values.room)).filter(Boolean))];
    const counts = new Map<string, number>();
    for (const a of m?.appliances ?? []) if (a.room) counts.set(a.room, (counts.get(a.room) ?? 0) + 1);
    return names.map((name) => ({ name, n: counts.get(name) ?? 0 }));
  }, [m]);
  const roomless = (m?.appliances ?? []).filter((a) => !a.room).length;
  const manuals = m?.appliances.reduce((n, a) => n + a.manuals.length, 0) ?? 0;
  // The starter card plans first (packs uplift item 8): the current season's pack, with only the jobs not
  // already there. What it lists is what Add all adds; with nothing missing the card goes away.
  const pack = useMemo(() => (m ? currentSeasonalPack(m.today) : SEASONAL_PACKS[0]), [m]);
  const plan = useMemo(() => planSeasonalPack(pack.id, m?.today ?? '2026-11-05', (m?.jobs ?? []).map((j) => j.name)), [m, pack.id]);
  const tints = ['amber', 'slate', 'blue', 'green'] as const;
  const dueJobs = m?.due ?? [];
  const warr = m?.warranties ?? [];
  const soon = warr.filter((a) => a.warrantyState === 'Warranty ends soon');
  // The kept line says only what there is (p15 packs-life, 4 Nov 2026, "empty states that say nothing go"): zero
  // parts drop out, and with nothing kept the fact goes away instead of reading "0 appliances · 0 rooms · 0 manuals".
  const kept = [m?.appliances.length ? plural(m.appliances.length, 'appliance') : '', rooms.length ? plural(rooms.length, 'room') : '', manuals ? plural(manuals, 'manual') : ''].filter((x) => x !== '').join(' · ');
  return (
    <PackPage label="House">
      <PackHead glyph="⌂" tint="slate" title="House" lead="Rooms, appliances, upkeep jobs and warranties for home."
        actions={<>{canEdit && <button type="button" className="btn pri" onClick={() => newAppliance(m)}>+ Add an appliance</button>}<MoreButton label="More for House" onOpen={(el) => openMenu(el, [
          { label: 'New maintenance job…', icon: 'task', disabled: !canEdit, run: () => newJob(m) },
          ...SEASONAL_PACKS.map((p) => ({ label: `Starter pack: ${p.name}`, icon: 'calendar' as const, disabled: !canEdit, run: () => void workDid(call<string>('add-seasonal-pack', p.id)) })),
          { label: m?.homes.length ? 'Add another home' : 'Add your home', icon: 'home', disabled: !canEdit, run: () => newHome() },
          { label: 'The house’s rooms and utilities', icon: 'grid', run: () => openModule(MOD, 'house') },
          { label: 'Every appliance', icon: 'bolt', run: () => openModule(MOD, 'appliances') },
          { label: 'House options…', icon: 'settings', disabled: !canEdit || !m, run: () => m && houseOptions(m.remindDays, m.jobDays) },
          { label: 'Show me around House', icon: 'sparkle', run: () => openTour('house') },
          { separator: true },
          { label: FULL_DETAILS_LABEL, icon: 'history', run: () => openModule(MOD, 'classic') },
        ])} /></>} />
      {m && <PageProps facts={[...(dueJobs.length || soon.length ? [{ k: 'Upkeep due', v: <>{dueJobs.length ? <span className="pill amber">{plural(dueJobs.length, 'job')}</span> : null}{dueJobs.length && soon.length ? ' ' : null}{soon.length ? <span className="pill red">{plural(soon.length, 'warranty', 'warranties')} ends soon</span> : null}</> }] : []), ...(kept ? [{ k: 'Kept', v: kept }] : [])]} />}
      {m && !m.appliances.length && !rooms.length && !m.jobs.length && <FillsLine id="house" />}
      {error && <p className="vsub">{error}</p>}
      {!m && !error && <p className="vsub">Reading your home…</p>}
      {m && (
        <Section label="Rooms">
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {rooms.map((r, i) => (
              <button key={r.name} type="button" className="card" style={{ flex: '1 1 140px', padding: '14px 16px', cursor: 'pointer', textAlign: 'left', font: 'inherit', color: 'var(--text)' }} onClick={() => openModule(MOD, 'appliances')} title={`${r.name}: open every appliance`}>
                <span className={`gtile xs ${tints[i % tints.length]}`}>⌂</span>
                <h3 style={{ marginTop: 8, fontSize: 14 }}>{r.name}</h3>
                <div className="meta">{plural(r.n, 'appliance')}</div>
              </button>
            ))}
            {!rooms.length && <div className="card" style={{ flex: 1 }}><p className="vsub">No rooms yet. Add your home for its rooms, or put each appliance in a room.{roomless ? ` ${plural(roomless, 'appliance')} without a room.` : ''}</p>{canEdit && !m.homes.length && <p style={{ marginTop: 8 }}><button type="button" className="btn" onClick={() => newHome()}>Add your home</button></p>}</div>}
          </div>
        </Section>
      )}
      {m && maintOn && (
        <Section label="Upkeep due" action={canEdit ? <button type="button" className="btn quiet" onClick={() => newJob(m)}>New job</button> : undefined}>
          {/* Bare when there is nothing but the line (t254); the rows keep their card. */}
          {!dueJobs.length ? (
            <p className="vsub" style={{ padding: '9px 0' }}>Nothing due. Add the jobs that come round to be told when each is due.</p>
          ) : (
          <div className="card" style={{ padding: '6px 20px' }}>
            <JobRows jobs={dueJobs.slice(0, 6)} m={m} canEdit={canEdit} />
          </div>
          )}
        </Section>
      )}
      {m && warrOn && !!warr.length && (
        <Section label="Warranties">
          <div className="card" style={{ padding: '6px 20px' }}>
            {warr.slice(0, 4).map((a) => (
              <div key={a.path} className="trow">
                <button type="button" className="t clip" style={{ background: 'none', border: 0, cursor: 'pointer', font: 'inherit', textAlign: 'left', color: 'var(--text)', fontSize: 15 }} onClick={() => openAppliance(a.path)}>{a.name}</button>
                <span className="meta" style={{ marginLeft: 'auto' }}>{a.warranty ? dayText(a.warranty) : ''}</span>
                <span className={`tag ${warrTint(a)}`}>{a.warrantyState ?? 'No warranty date'}</span>
              </div>
            ))}
          </div>
        </Section>
      )}
      {m && canEdit && plan.jobs.length > 0 && (
        <Section label={`${pack.name} starter pack`}>
          <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 20px' }}>
            <span className="gtile xs amber">☀</span>
            <div style={{ minWidth: 0 }}><div style={{ fontSize: 14, fontWeight: 600 }}>{plural(plan.jobs.length, 'job')} ready</div><div className="meta">{plan.jobs.map((j) => j.name.toLowerCase()).join(', ')}</div></div>
            <button type="button" className="btn" style={{ marginLeft: 'auto', flex: 'none' }} onClick={() => void workDid(call<string>('add-seasonal-pack', pack.id))}>Add all</button>
          </div>
        </Section>
      )}
      {m && <HomeCard pack="House jobs due" glyph="⌂" tint="slate" title={dueJobs.length ? `${plural(dueJobs.length, 'job')} due${warr.length && warr[0].warranty ? ` · ${warr[0].name.toLowerCase()} warranty ends ${dayText(warr[0].warranty)}` : ''}` : 'Nothing due'} meta={dueJobs.length ? 'click to mark done' : ''} />}
    </PackPage>
  );
}

// ── An appliance's page ──────────────────────────────────────────────────────────────────────────────────────────

export function ApplianceDetail({ path }: { path: string }) {
  const canEdit = useCanEdit();
  const { data: m, error, reload } = useWork<HouseView>(MOD);
  const a = m?.appliances.find((x) => x.path === path);
  if (!m) return <PackReadState label="House" error={error} reload={reload}>Reading your home…</PackReadState>;
  if (!a) return <PackPage label="House"><div className="card" style={{ marginTop: 14 }}><p className="vsub">That appliance isn’t here any more.</p><p style={{ marginTop: 8 }}><button type="button" className="btn" onClick={() => openModule(MOD)}>House</button></p></div></PackPage>;
  const prop = (field: string) => (v: string) => save('appliance', a.path, field, v);
  const jobs = m.jobs.filter((j) => a.jobs.includes(j.path));
  const lastDone = jobs.flatMap((j) => j.done.map((d) => d.date)).filter(Boolean).sort().pop();
  const nextDue = jobs.map((j) => j.nextDue).filter(Boolean).sort()[0];
  const title = [a.make, a.model].filter(Boolean).join(' ');
  const bought = [a.purchased ? dayText(a.purchased) : '', a.supplier ? `from ${a.supplier}` : '', a.price !== null ? money(a.price, m.currency) : ''].filter(Boolean).join(', ');
  const steps = warrantyChecklist(a, m.today);
  const history = [...a.history].sort((x, y) => (y.date ?? '').localeCompare(x.date ?? ''));
  const copyLink = () => { void navigator.clipboard.writeText(writeLink(a.path, undefined)).then(() => toast('A link to the appliance is on the clipboard.')); };
  return (
    <PackPage label={a.name}>
      <PackHead glyph="⌂" tint="slate" title={title ? `${a.name}, ${title}` : a.name} lead={[a.room, bought ? `Bought ${bought}` : ''].filter(Boolean).join('. ')} sharePath={a.path}
        actions={<>{canEdit && <button type="button" className="btn" onClick={() => void keepFiles(MOD, a.path, a.name, 'documents')}>Add a manual</button>}<MoreButton label={`More for ${a.name}`} onOpen={(el) => openMenu(el, [
          { label: 'Add a service or repair…', icon: 'settings', disabled: !canEdit, run: () => addHistory(a, m.today) },
          { label: 'Add a job for it…', icon: 'task', disabled: !canEdit, run: () => newJob(m, { appliance: a.name, room: a.room }) },
          { label: 'Copy link', icon: 'link', run: copyLink },
          { label: 'Open its note', icon: 'notes', run: () => A.openPath(a.path, { where: 'tab' }) },
          { label: EDIT_DETAILS_LABEL, icon: 'table', run: () => openModule(MOD, `classic:appliance:${encodeURIComponent(a.path)}`) },
          { separator: true },
          { label: deleteToBin('the appliance'), icon: 'trash', danger: true, disabled: !canEdit, run: () => void trashRecord(a.path).then((ok) => ok && openModule(MOD)) },
        ])} /></>} />
      <PageProps facts={[
        ...(a.warranty ? [{ k: 'Warranty', v: <span className={`pill ${warrTint(a)}`}>{a.warrantyState === 'Out of warranty' ? `Ended ${nodow(a.warranty)}` : `Until ${nodow(a.warranty)}`}</span> }] : []),
        ...((a.serial || a.model) ? [{ k: 'Serial', v: [a.serial, a.model ? `model ${a.model}` : ''].filter(Boolean).join(' · ') }] : []),
        ...((lastDone || nextDue) ? [{ k: 'Upkeep', v: [lastDone ? `last done ${dayText(lastDone)}` : '', nextDue ? `next due ${dayText(nextDue)}` : ''].filter(Boolean).join(' · ') }] : []),
      ]} />
      <Section label="Manual and receipt" action={canEdit ? <button type="button" className="btn quiet" onClick={() => void keepFiles(MOD, a.path, a.name, 'documents')}>Add</button> : undefined}>
        {/* Bare when there is nothing but the line (t258, the shared RowsCard); the rows keep their card. */}
        <RowsCard empty={!a.files.length} words="Keep its manual, the receipt and the warranty card here, so they are there when it breaks.">
          {a.files.map((f) => (
            <div key={f} className="trow">
              <span className="gtile xs slate">▤</span>
              <button type="button" className="t clip" style={{ background: 'none', border: 0, cursor: 'pointer', font: 'inherit', textAlign: 'left', color: 'var(--text)', fontSize: 15 }} onClick={() => A.openPath(f)}>{fileName(f)}</button>
              <span style={{ marginLeft: 'auto' }}>{canEdit && <button type="button" className="btn quiet" aria-label={`Delete ${fileName(f)} to the Bin`} onClick={() => void trashRecord(f)}>Delete</button>}</span>
            </div>
          ))}
        </RowsCard>
      </Section>
      {!!jobs.length && (
        <Section label="Its jobs" action={canEdit ? <button type="button" className="btn quiet" onClick={() => newJob(m, { appliance: a.name, room: a.room })}>Add a job</button> : undefined}>
          <div className="card" style={{ padding: '6px 20px' }}><JobRows jobs={jobs} m={m} canEdit={canEdit} /></div>
        </Section>
      )}
      {!!history.length && (
        <Section label="Service history" action={canEdit ? <button type="button" className="btn quiet" onClick={() => addHistory(a, m.today)}>Add a service</button> : undefined}>
          <div className="card" style={{ padding: '6px 20px' }}>
            {history.slice(0, 6).map((h) => (
              <div key={h.row} className="trow">
                <span className="t clip">{h.what}</span>
                <span className="meta" style={{ marginLeft: 'auto' }}>{[h.date ? dayText(h.date) : h.dateWords, h.by, h.cost !== null ? money(h.cost, m.currency) : ''].filter(Boolean).join(' · ')}</span>
                {canEdit && <button type="button" className="btn quiet" aria-label={`Take ${h.what} out`} onClick={() => void workDid(call<string>('remove-row', a.path, 'history', h.row, h.what))}>Take out</button>}
              </div>
            ))}
          </div>
        </Section>
      )}
      <Section label="If it breaks down">
        <div className="card">
          <ol style={{ margin: '0 0 0 20px', fontSize: 15 }}>
            {(steps.length ? steps : [`Ring ${a.supplier || 'where you bought it'} with the serial above.`, a.warranty ? `Say it is under warranty until ${dayText(a.warranty)}.` : 'Say when you bought it and what is wrong.', 'Keep the job number with this page.']).map((step, i) => (
              <li key={i} style={{ margin: '5px 0' }}>{step}</li>
            ))}
          </ol>
        </div>
      </Section>
      <Section label="Details">
        <div className="card" style={{ padding: '6px 20px' }}>
          <div className="trow"><span className="t">Kind</span><span style={{ marginLeft: 'auto' }}><Inline value={a.kind} label="Kind" kind="choice" options={[...APPLIANCE_KINDS]} canEdit={canEdit} onSave={prop('appliance_kind')} /></span></div>
          <div className="trow"><span className="t">Room</span><span style={{ marginLeft: 'auto' }}><Inline value={a.room} label="Room" canEdit={canEdit} onSave={prop('room')} /></span></div>
          <div className="trow"><span className="t">Make</span><span style={{ marginLeft: 'auto' }}><Inline value={a.make} label="Make" canEdit={canEdit} onSave={prop('make')} /></span></div>
          <div className="trow"><span className="t">Model</span><span style={{ marginLeft: 'auto' }}><Inline value={a.model} label="Model" canEdit={canEdit} onSave={prop('model')} /></span></div>
          <div className="trow"><span className="t">Serial</span><span style={{ marginLeft: 'auto' }}><Inline value={a.serial} label="Serial" canEdit={canEdit} onSave={prop('serial')} /></span></div>
          <div className="trow"><span className="t">Status</span><span style={{ marginLeft: 'auto' }}><Inline value={a.status} label="Status" kind="choice" options={[...APPLIANCE_STATUSES]} canEdit={canEdit} onSave={prop('status')} /></span></div>
          <div className="trow"><span className="t">Warranty ends</span><span style={{ marginLeft: 'auto' }}><Inline value={a.warranty ?? ''} shown={a.warranty ? dayText(a.warranty) : undefined} label="Warranty ends" kind="date" canEdit={canEdit} onSave={prop('warranty')} /></span></div>
        </div>
      </Section>
      <AskFloat scope={a.path} />
    </PackPage>
  );
}

/** House's page switch: the new overview, an appliance's new page, the rest as before. */
export function housePlace(tab: W.TabState): 'overview' | 'appliance' | 'classic' | 'rest' {
  const part = partOfTab(tab) ?? 'overview';
  if (part === 'classic' || part.startsWith('classic:')) return 'classic';
  if (part.startsWith('appliance:')) return 'appliance';
  if (part === 'overview' || part === '') return 'overview';
  return 'rest';
}
export const appliancePathOf = (tab: W.TabState): string | null => {
  const part = partOfTab(tab) ?? '';
  if (!part.startsWith('appliance:')) return null;
  // 'appliance:' is 10 long (t258, 13 Nov 2026: slice(11) dropped the path's first letter, so no
  // appliance's page ever opened ("that appliance isn't here any more": found walking the detail).
  try { return decodeURIComponent(part.slice(10)); } catch { return part.slice(10); }
};
export { HOUSE };
