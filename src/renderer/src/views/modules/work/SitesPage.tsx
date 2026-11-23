// Sites and Equipment's page (Wave 6 part b; src/shared/work-sites.ts, src/main/work/sites.ts). Made of the work modules'
// shared blocks (WorkShell): an Overview of what needs doing (warranties and ends of life, patch work, the spare pool) and
// every site as a card; Sites, Inventory, Patch schedule and Warranty and end of life as record views anyone can change;
// and each site's own register page ("site:<path>"): its details, its rooms with the devices in each, its patch points as
// a table changed cell by cell, its devices and its photos. Everything shown changes where it is.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { partOn } from '../../../../../shared/life-modules';
import { DEVICE_KINDS, DEVICE_STATUSES, PATCH_STATUSES, SITE_KINDS, SITE_STATUSES, SITES } from '../../../../../shared/work-modules';
import { siteRecords, siteSectionViews, SITE_EDITABLE, type Device, type PatchPoint, type Site, type SitesModel } from '../../../../../shared/work-sites';
import type { WsRecord } from '../../../../../shared/workspace-records';
import { plural } from '../../../../../shared/words';
import { EmptyState } from '../../../components/EmptyState';
import { Icon, type IconName } from '../../../components/Icon';
import { openMenu, type MenuItem } from '../../../components/Menu';
import { fileUrl } from '../../../lib/resolve';
import * as A from '../../../state/actions';
import { openTour } from '../../../state/moduleFills';
import { openModule, useModules } from '../../../state/modules';
import { peek } from '../../../state/peek';
import { showError, useApp } from '../../../state/store';
import { useWork, workCall, workDid } from '../../../state/workModules';
import type * as W from '../../../state/workspace';
import { openRecordForm, valueWords } from '../RecordForm';
import { AskFloat, PackSection, PackShell, Tick, packName, rowContext, rowMenu, shortDay, weekdayOf, type Tint } from '../pack87';
import { dayText, openDetail, Pill, placeOf, useWorkCtx, WithRecords, WorkViews } from './WorkShell';
import { isEnterKey } from '../../../lib/enterKey';

/** A site's register page (WorkShell keeps the note's path in the tab without its slashes). */
const openSite = (rel: string) => openDetail('sites', 'site', rel);
const siteKey = (key: string) => key;

type SitesView = SitesModel & { folder: string; people: string[]; projects: { path: string; name: string }[] };

const DEVICE_ICON: Record<string, IconName> = { Laptop: 'computer', Desktop: 'computer', Tablet: 'computer', Phone: 'chat', POS: 'receipt', Printer: 'file', Display: 'present', AV: 'audio', Camera: 'video', Switch: 'branch', Router: 'branch', 'Access point': 'branch', Firewall: 'lock', Server: 'server' };
const SITE_ICON: Record<string, IconName> = { Office: 'briefcase', Store: 'receipt', Warehouse: 'layers', 'Data centre': 'server', Venue: 'star', Showroom: 'image', Home: 'home' };
const deviceIcon = (k: string): IconName => DEVICE_ICON[k] ?? 'tag';
// One plural rule everywhere (3 Nov 2026, fourth-round G5-G7): imported from shared/words above.
const lifeTone = (l: Device['lifecycle']) => (l === 'End of life' ? 'bad' : l === 'Out of warranty' || l === 'End of life soon' || l === 'Warranty ends soon' ? 'warn' : l === 'Under warranty' ? 'ok' : 'none');
const statusTone = (s: string) => (/^(in use|live|active)$/i.test(s) ? 'ok' : /^(in repair|faulty|closed)$/i.test(s) ? 'bad' : /^(to patch|planned|on order|moving|closing)$/i.test(s) ? 'warn' : 'none');

// ── Doing things ─────────────────────────────────────────────────────────────────────────────────────────────────────

const call = <T,>(name: string, ...args: unknown[]) => workCall<T>('sites', name, ...args);

/** One value changed where it shows (a property, or one cell of a table's row). */
async function save(payload: { kind: string; path: string; field: string; value: string; row?: number; title?: string }): Promise<boolean> {
  // The job answers null when it has nothing to say: only a thrown error means it wasn't written.
  const r = await workDid(call<string | null>('set-field', { ...payload, ref: payload.row !== undefined ? { row: payload.row } : null }).then((said) => ({ said })), (x) => x.said ?? '');
  return r !== null;
}

function newSite(m: SitesView | null): void {
  openRecordForm({
    title: 'New site',
    icon: 'pin',
    line: 'An office, store, warehouse or venue. Its rooms, patch points, devices and photos are kept with it.',
    ok: 'Add the site',
    fields: [
      { key: 'name', label: 'Name', kind: 'text', required: true, wide: true, placeholder: 'Harbour Central' },
      { key: 'kind', label: 'Kind', kind: 'choice', options: [...SITE_KINDS], value: 'Office' },
      { key: 'code', label: 'Code', kind: 'text', placeholder: 'HC-01', hint: 'A store number or site code, if it has one.' },
      { key: 'address', label: 'Address', kind: 'text', wide: true },
      { key: 'contact', label: 'Contact', kind: 'choice', options: ['', ...(m?.people ?? [])], own: true, hint: m?.people.length ? undefined : 'Type a name: a People note can be made for them later.' },
      { key: 'status', label: 'Status', kind: 'choice', options: [...SITE_STATUSES], value: 'Active' },
      { key: 'project', label: 'Project', kind: 'choice', options: ['', ...(m?.projects.map((p) => p.name) ?? [])], hint: 'A fit-out, move or survey this site is part of.' },
    ],
    submit: async (v) => {
      const rel = await call<string>('add-site', { name: valueWords(v, 'name'), kind: valueWords(v, 'kind'), code: valueWords(v, 'code'), address: valueWords(v, 'address'), contact: valueWords(v, 'contact'), status: valueWords(v, 'status'), project: valueWords(v, 'project') });
      await workDid(Promise.resolve(rel), `Added the site ${valueWords(v, 'name')}.`, { label: 'Open', run: () => openSite(rel) });
    },
  });
}

function newDevice(m: SitesView | null, prefill: { site?: string; room?: string; status?: string } = {}): void {
  const sites = m?.sites.map((s) => s.name) ?? [];
  openRecordForm({
    title: 'New device',
    icon: 'computer',
    line: 'Where it is, its serial, whose it is and when its warranty ends. Its warranty comes to Today before it ends.',
    ok: 'Add the device',
    fields: [
      { key: 'kind', label: 'Kind', kind: 'choice', options: [...DEVICE_KINDS], value: 'Laptop' },
      { key: 'status', label: 'Status', kind: 'choice', options: [...DEVICE_STATUSES], value: prefill.status ?? 'In use' },
      { key: 'make', label: 'Make', kind: 'text', placeholder: 'Brightline' },
      { key: 'model', label: 'Model', kind: 'text', placeholder: 'L14 Gen 4' },
      { key: 'serial', label: 'Serial', kind: 'text' },
      { key: 'asset_tag', label: 'Asset tag', kind: 'text' },
      { key: 'site', label: 'Site', kind: 'choice', options: ['', ...sites], value: prefill.site ?? '', hint: sites.length ? undefined : 'Add a site first to place it there.' },
      { key: 'room', label: 'Room', kind: 'text', value: prefill.room ?? '' },
      { key: 'assigned', label: 'Assigned to', kind: 'choice', options: ['', ...(m?.people ?? [])], own: true },
      { key: 'purchased', label: 'Purchased', kind: 'date' },
      { key: 'warranty', label: 'Warranty ends', kind: 'date' },
      { key: 'eol', label: 'End of life', kind: 'date', hint: 'When it should be replaced.' },
    ],
    submit: async (v) => {
      const input = Object.fromEntries(['kind', 'status', 'make', 'model', 'serial', 'asset_tag', 'site', 'room', 'assigned', 'purchased', 'warranty', 'eol'].map((k) => [k, valueWords(v, k)]));
      const rel = await call<string>('add-device', input);
      await workDid(Promise.resolve(rel), `Added ${A.titleOf(rel)}.`, { label: 'Open', run: () => peek({ type: 'note', path: rel }, { title: A.titleOf(rel), type: 'note' }) });
    },
  });
}

function newRoom(s: Site): void {
  openRecordForm({
    title: `New room at ${s.name}`,
    icon: 'grid',
    ok: 'Add the room',
    fields: [
      { key: 'room', label: 'Room', kind: 'text', required: true, placeholder: 'Comms room' },
      { key: 'floor', label: 'Floor', kind: 'text', placeholder: 'Ground' },
      { key: 'purpose', label: 'Purpose', kind: 'text', wide: true, placeholder: 'Network rack and the alarm panel' },
      { key: 'notes', label: 'Notes', kind: 'text', wide: true },
    ],
    submit: async (v) => {
      await call('add-room', s.path, { title: valueWords(v, 'room'), floor: valueWords(v, 'floor'), purpose: valueWords(v, 'purpose'), notes: valueWords(v, 'notes') });
      // After-add rule (9.2 uplift F43): it went to the list — its name, and a link that opens it. Never auto-open.
      await workDid(Promise.resolve(null), `Added the room ${valueWords(v, 'room')} at ${s.name}.`, { label: 'Open', run: () => openSite(s.path) });
    },
  });
}

function newPatch(at: Site | null, m: SitesView | null): void {
  const sites = m?.sites ?? [];
  const s = at ?? sites[0];
  if (!s) return newSite(m);
  const devices = (m?.devices ?? []).filter((d) => (at ? d.sitePath === at.path : true) && d.status !== 'Retired').map((d) => d.name);
  const rooms = [...new Set((at ? [at] : sites).flatMap((x) => x.rooms.map((r) => r.name)).filter(Boolean))];
  openRecordForm({
    title: at ? `New patch point at ${at.name}` : 'New patch point',
    icon: 'branch',
    line: 'One outlet or panel port: where it goes on the switch, and when it is to be patched.',
    ok: 'Add the patch point',
    fields: [
      ...(at ? [] : [{ key: 'site', label: 'Site', kind: 'choice' as const, options: sites.map((x) => x.name), value: s.name, wide: true }]),
      { key: 'point', label: 'Point', kind: 'text', required: true, placeholder: 'A-01' },
      { key: 'room', label: 'Room', kind: 'choice', options: ['', ...rooms], own: true },
      { key: 'switch', label: 'Switch', kind: 'text', placeholder: 'SW1' },
      { key: 'port', label: 'Port', kind: 'text', placeholder: '12' },
      { key: 'vlan', label: 'VLAN', kind: 'text', placeholder: '20' },
      { key: 'device', label: 'Device', kind: 'choice', options: ['', ...devices], own: true },
      { key: 'status', label: 'Status', kind: 'choice', options: [...PATCH_STATUSES], value: 'To patch' },
      { key: 'date', label: 'Date', kind: 'date', hint: 'When it is to be patched (or was).' },
      { key: 'notes', label: 'Notes', kind: 'text', wide: true },
    ],
    submit: async (v) => {
      const values = { title: valueWords(v, 'point'), ...Object.fromEntries(['room', 'switch', 'port', 'vlan', 'device', 'status', 'date', 'notes'].map((k) => [k, valueWords(v, k)])) };
      const where = at ?? sites.find((x) => x.name === valueWords(v, 'site')) ?? s;
      await call('add-patch', where.path, values);
      await workDid(Promise.resolve(null), `Added patch point ${values.title}.`);
    },
  });
}

async function addPhotos(rel: string, name: string): Promise<void> {
  const files = await workDid(call<string[]>('pick-photos', `Photos to keep with ${name}`), '');
  if (files?.length) await workDid(call<string>('keep-photos', rel, files));
}

function newWarranty(d: Device): void {
  openRecordForm({
    title: `New warranty date for ${d.name}`,
    icon: 'clock',
    line: 'When the warranty was extended or renewed, the day it now ends.',
    ok: 'Save it',
    fields: [{ key: 'warranty', label: 'Warranty ends', kind: 'date', required: true, value: d.warranty ?? '' }],
    submit: async (v) => {
      await call('set-field', { kind: 'device', path: d.path, field: 'warranty', value: valueWords(v, 'warranty') });
      await workDid(Promise.resolve(null), `${d.name}’s warranty now ends ${dayText(valueWords(v, 'warranty'))}.`);
    },
  });
}

function moveToSite(d: Device, m: SitesView | null): void {
  openRecordForm({
    title: `Move ${d.name}`,
    icon: 'pin',
    ok: 'Move it',
    fields: [
      { key: 'site', label: 'Site', kind: 'choice', options: ['', ...(m?.sites.map((s) => s.name) ?? [])], value: d.site },
      { key: 'room', label: 'Room', kind: 'text', value: d.room },
      { key: 'status', label: 'Status', kind: 'choice', options: [...DEVICE_STATUSES], value: d.status },
    ],
    submit: async (v) => {
      await workDid(call<string>('move-device', d.path, { site: valueWords(v, 'site'), room: valueWords(v, 'room'), status: valueWords(v, 'status') }));
    },
  });
}

function sitesOptions(remind: number): void {
  openRecordForm({
    title: `${packName('sites', 'Sites')} options`,
    icon: 'settings',
    ok: 'Save',
    fields: [{ key: 'remind', label: 'Say a warranty or end of life is coming this many days ahead', kind: 'number', value: String(remind), hint: 'On Today, in the bell and on the Overview. 90 unless you change it.' }],
    submit: async (v) => {
      const n = Math.max(0, Math.min(365, Math.round(Number(valueWords(v, 'remind')) || 0)));
      await workDid(call('options', { remindDays: n }), `Warranties and ends of life now come up ${plural(n, 'day')} ahead.`);
    },
  });
}

function deviceMenu(d: Device, m: SitesView | null, canEdit: boolean): MenuItem[] {
  return [
    { label: 'Open', icon: 'eye', run: () => peek({ type: 'note', path: d.path }, { title: d.name, type: 'note' }) },
    { separator: true },
    { label: 'Move to another site or room…', icon: 'pin', disabled: !canEdit, run: () => moveToSite(d, m) },
    { label: d.status === 'Spare' ? 'Put it in use' : 'Put it in the spare pool', icon: 'layers', disabled: !canEdit, run: () => void workDid(call<string>('move-device', d.path, d.status === 'Spare' ? { status: 'In use' } : { status: 'Spare', room: '' })) },
    { label: 'New warranty date…', icon: 'clock', disabled: !canEdit, run: () => newWarranty(d) },
    { label: 'Keep a photo with it…', icon: 'image', disabled: !canEdit, run: () => void addPhotos(d.path, d.name) },
    { label: 'Mark retired', icon: 'close', disabled: !canEdit || d.status === 'Retired', run: () => void save({ kind: 'device', path: d.path, field: 'status', value: 'Retired' }) },
    { separator: true },
    { label: 'Open its note', icon: 'notes', run: () => A.openPath(d.path, { where: 'tab' }) },
    { label: 'Delete', icon: 'trash', danger: true, disabled: !canEdit, run: () => void A.trashPath(d.path).catch(showError) },
  ];
}

// ── A value changed where it shows ───────────────────────────────────────────────────────────────────────────────────

function Inline({ value, shown, label, kind = 'text', options, canEdit, placeholder, onSave, className }: { value: string; shown?: ReactNode; label: string; kind?: 'text' | 'date' | 'choice'; options?: readonly string[]; canEdit: boolean; placeholder?: string; onSave(v: string): Promise<boolean>; className?: string }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement | HTMLSelectElement | null>(null);
  useEffect(() => {
    if (!editing) setText(value);
  }, [value, editing]);
  useEffect(() => {
    if (editing) {
      input.current?.focus();
      if (input.current instanceof HTMLInputElement) input.current.select();
    }
  }, [editing]);
  const done = async (v: string) => {
    if (busy) return;
    if (v.trim() === value.trim()) return setEditing(false);
    setBusy(true);
    const ok = await onSave(v.trim());
    setBusy(false);
    if (ok) setEditing(false);
  };
  if (!editing)
    return (
      <button type="button" className={`wm-inline${value ? '' : ' is-empty'}${className ? ` ${className}` : ''}`} disabled={!canEdit} title={canEdit ? `Change ${label.toLowerCase()}` : undefined} aria-label={`${label}: ${value || 'not set'}${canEdit ? ', change it' : ''}`} onClick={() => setEditing(true)}>
        {value ? (shown ?? value) : <span className="wm-inline-none">{canEdit ? placeholder ?? 'Add' : ''}</span>}
      </button>
    );
  if (kind === 'choice') {
    const list = options && !options.includes(value) && value ? [value, ...options] : options ?? [];
    return (
      <select ref={(el) => void (input.current = el)} className="wm-inline-edit" aria-label={label} value={text} disabled={busy} onChange={(e) => void done(e.target.value)} onBlur={() => setEditing(false)} onKeyDown={(e) => e.key === 'Escape' && setEditing(false)}>
        {list.map((o) => (
          <option key={o} value={o}>
            {o || ''}
          </option>
        ))}
      </select>
    );
  }
  return (
    <input
      ref={(el) => void (input.current = el)}
      className="wm-inline-edit"
      aria-label={label}
      type={kind === 'date' ? 'date' : 'text'}
      value={text}
      disabled={busy}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => void done(text)}
      onKeyDown={(e) => {
        if (isEnterKey(e)) void done(text);
        if (e.key === 'Escape') setEditing(false);
      }}
    />
  );
}

// ── Overview ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A site register's cover: its first photo, or its kind's mark when the file is gone (p15, Nov 2026). */
function SiteThumb({ photo, kind }: { photo: string | undefined; kind: string }) {
  const [gone, setGone] = useState(false);
  if (!photo || gone) return <Icon name={SITE_ICON[kind] ?? 'pin'} size={20} />;
  return <img src={fileUrl(photo)} alt="" loading="lazy" onError={() => setGone(true)} />;
}

/** One photo on a site's page: the file, or a tile when it is gone (p15, Nov 2026: a missing file never shows broken). */
function SitePhoto({ p }: { p: string }) {
  const [gone, setGone] = useState(false);
  const name = p.split('/').pop() ?? '';
  return (
    <button type="button" className="wm-photo" title={name} onClick={() => A.openPath(p, { where: 'tab' })}>
      {gone ? (
        <span style={{ display: 'grid', placeItems: 'center', width: '100%', height: '100%', color: 'var(--text-faint)' }} aria-hidden="true">
          <Icon name="image" size={22} />
        </span>
      ) : (
        <img src={fileUrl(p)} alt={name} loading="lazy" onError={() => setGone(true)} />
      )}
    </button>
  );
}

function SiteCard({ s }: { s: Site }) {
  const photo = s.photos[0];
  return (
    <li className={`wm-site${s.status === 'Closed' ? ' is-closed' : ''}`}>
      <button type="button" className="wm-site-main" onClick={() => openSite(s.path)}>
        <span className="wm-site-pic" aria-hidden="true">
          <SiteThumb photo={photo} kind={s.kind} />
        </span>
        <span className="wm-site-words">
          <span className="wm-site-name">{s.name}</span>
          <span className="wm-site-sub">{[s.kind, s.code].filter(Boolean).join(' · ')}</span>
          {s.address && <span className="wm-site-sub">{s.address}</span>}
        </span>
      </button>
      <div className="wm-site-stats">
        {s.status !== 'Active' && <Pill tone={statusTone(s.status)}>{s.status}</Pill>}
        <span>{plural(s.rooms.length, 'room')}</span>
        <span>{plural(s.devices, 'device')}</span>
        {s.spare > 0 && <span>{s.spare} spare</span>}
        {s.toPatch > 0 && <span className="is-warn">{s.toPatch} to patch</span>}
      </div>
    </li>
  );
}

/** A patch job still to do: ticked live where it shows, on its site's page when opened. */
function PatchTrow({ x, canEdit, today }: { x: PatchPoint; canEdit: boolean; today: string }) {
  const late = x.days !== null && x.days < 0;
  const markLive = () => void save({ kind: 'patch', path: x.site, row: x.row, title: x.point, field: 'status', value: 'Live' }).then((ok) => ok && x.date === null && save({ kind: 'patch', path: x.site, row: x.row, title: x.point, field: 'date', value: today }));
  const title = x.switch || x.port ? `${x.point} · ${[x.switch, x.port && `port ${x.port}`].filter(Boolean).join(' ')}` : x.point;
  // A patch job names its site where it shows (p15, Nov 2026: six "A-02" rows with no site each opened somewhere else).
  const meta = [x.siteName, x.notes, !x.date && !x.notes ? x.dateWords : null].filter(Boolean).join(' · ');
  const tag = late ? { tone: 'red' as Tint, words: `${-x.days!} ${-x.days! === 1 ? 'day' : 'days'} overdue` } : x.date && x.days !== null && x.days <= 7 ? { tone: 'amber' as Tint, words: weekdayOf(x.date) } : x.date ? { tone: 'slate' as Tint, words: shortDay(x.date) } : { tone: 'slate' as Tint, words: x.status || 'To patch' };
  return (
    <div className="trow" {...rowContext(() => [{ label: 'Mark live', icon: 'check', disabled: !canEdit, run: markLive }, { label: `Open ${x.siteName}`, icon: 'pin', run: () => openSite(x.site) }, { separator: true }, { label: 'Take it out', icon: 'trash', danger: true, disabled: !canEdit, run: () => void workDid(call<string>('remove-row', x.site, 'patch', x.row, x.point)) }])}>
      <Tick label={`Mark ${x.point} live`} onTick={markLive} />
      <button type="button" onClick={() => openSite(x.site)} className="t" title={`${title} at ${x.siteName}`} style={{ border: 0, background: 'none', padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer', textAlign: 'left' }}>
        {title}
      </button>
      <span className="end">
        {meta ? <span className="meta">{meta} ·</span> : null}
        <span className={`tag ${tag.tone}`}>{tag.words}</span>
      </span>
    </div>
  );
}

function SiteTrow({ s, patch }: { s: Site; patch: boolean }) {
  const where = [s.kind, s.code].filter(Boolean).join(' ');
  return (
    <div className="trow" {...rowContext(() => rowMenu(s.path, s.name, () => openSite(s.path)))}>
      <span className="gtile xs slate" aria-hidden="true">
        ▦
      </span>
      <button type="button" onClick={() => openSite(s.path)} className="t" title={s.name} style={{ border: 0, background: 'none', padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer', textAlign: 'left' }}>
        {s.name}
        {where ? ` · ${where}` : ''}
      </button>
      <span className="end">
        <span className="meta">{`${plural(s.rooms.length, 'room')} · ${plural(s.devices, 'device')}`}{patch && s.patch.length > 0 ? ' ·' : ''}</span>
        {/* "All live" only earns its tag when points exist (p15, Nov 2026): a site with no patch panel is not "live". */}
        {patch && s.patch.length > 0 && (s.toPatch > 0 ? <span className="tag amber">{`${s.toPatch} to patch`}</span> : <span className="tag green">All live</span>)}
      </span>
    </div>
  );
}

function Overview({ m, canEdit }: { m: SitesView; canEdit: boolean }) {
  const modules = useModules();
  const life = partOn(modules, 'sites', 'lifecycle');
  const patch = partOn(modules, 'sites', 'patch');
  const lapsing = life ? m.lifecycle.filter((l) => l.days <= 14) : [];
  const passed = lapsing.filter((l) => l.days < 0);
  const ending = lapsing.filter((l) => l.days >= 0);
  const repair = m.devices.filter((d) => d.status === 'In repair').length;
  const kept = m.devices.filter((d) => d.status !== 'Retired').length;
  const jobs = patch ? m.toPatch.length : 0;
  const week = patch ? m.toPatch.filter((x) => x.days === null || x.days <= 7).slice(0, 6) : [];
  // The register says what it keeps, never zeros (p15, Nov 2026): bare sites read "8 sites", not "8 sites · 0 devices".
  const keptFacts = [m.sites.length ? plural(m.sites.length, 'site') : '', kept ? plural(kept, 'device') : '', jobs ? `${jobs} ${jobs === 1 ? 'patch job' : 'patch jobs'} to do` : ''].filter(Boolean).join(' · ');
  return (
    <PackShell
      glyph="▦"
      tint="slate"
      title={packName('sites', 'Sites')}
      sub="Rooms, gear, serials, patch points and photos for each site."
      facts={[
        { k: 'Kept', v: keptFacts },
        {
          k: 'Needs you',
          v: (
            <>
              {passed.length ? <span className="pill red">{passed.length === 1 ? '1 warranty passed' : `${passed.length} warranties passed`}</span> : null}
              {ending.length ? <span className="pill amber">{ending.length === 1 ? '1 warranty ending' : `${ending.length} warranties ending`}</span> : null}
              {repair ? <span className="pill amber">{repair === 1 ? '1 device in repair' : `${repair} devices in repair`}</span> : null}
              {!lapsing.length && !repair ? <span className="pill green">Nothing needs you</span> : null}
            </>
          ),
        },
      ]}
      actions={
        <button type="button" className="btn pri" disabled={!canEdit} onClick={() => newSite(m)}>
          + Add a site
        </button>
      }
      menu={() => sitesMenu(m, canEdit)}
    >
      <PackSection label="Sites">
        {m.sites.length ? (
          m.sites.map((s) => <SiteTrow key={s.path} s={s} patch={patch} />)
        ) : (
          <p className="vsub">No sites yet.</p>
        )}
      </PackSection>
      {patch && (
        <PackSection label="Patch work to do">
          {week.length ? (
            week.map((x) => <PatchTrow key={`${x.site}:${x.row}`} x={x} canEdit={canEdit} today={m.today} />)
          ) : (
            // A quiet line, not a box (p15, Nov 2026): the sheet flattens a card holding only this line.
            <p className="vsub">
              <span className="pill green">Everything live</span>
            </p>
          )}
        </PackSection>
      )}
    </PackShell>
  );
}

// ── A site's register ────────────────────────────────────────────────────────────────────────────────────────────────

function DeviceRow({ d, m, canEdit, here }: { d: Device; m: SitesView; canEdit: boolean; here?: boolean }) {
  return (
    <li className="wm-dev">
      <button type="button" className="wm-dev-main" onClick={() => peek({ type: 'note', path: d.path }, { title: d.name, type: 'note' })}>
        <span className="wm-dev-icon" aria-hidden="true">
          <Icon name={deviceIcon(d.kind)} size={14} />
        </span>
        <span className="wm-dev-words">
          <span className="wm-dev-name">{d.name}</span>
          <span className="wm-dev-sub">{[d.kind, d.serial && `S/N ${d.serial}`, d.assetTag && `Tag ${d.assetTag}`, !here && d.room, d.assigned].filter(Boolean).join(' · ')}</span>
        </span>
      </button>
      <span className="wm-dev-end">
        {d.status !== 'In use' && <Pill tone={statusTone(d.status)}>{d.status}</Pill>}
        {d.lifecycle && d.lifecycle !== 'Under warranty' && <Pill tone={lifeTone(d.lifecycle)} title={d.warranty ? `Warranty ends ${dayText(d.warranty)}` : undefined}>{d.lifecycle}</Pill>}
        <button type="button" className="icon-button small" aria-label={`More for ${d.name}`} onClick={(e) => openMenu(e.currentTarget, deviceMenu(d, m, canEdit))}>
          <Icon name="more" size={13} />
        </button>
      </span>
    </li>
  );
}

function SiteRoomRow({ s, r, m, canEdit, open, onToggle }: { s: Site; r: Site['rooms'][number]; m: SitesView; canEdit: boolean; open: boolean; onToggle(): void }) {
  const here = m.devices.filter((d) => d.sitePath === s.path && d.status !== 'Retired');
  const ds = here.filter((d) => r.name && d.room.toLowerCase() === r.name.toLowerCase());
  const pts = s.patch.filter((p) => r.name && p.room.toLowerCase() === r.name.toLowerCase());
  const due = pts.filter((p) => p.status !== 'Live').length;
  const cellSave = (field: string) => (v: string) => save({ kind: 'room', path: s.path, row: r.row, title: r.name, field, value: v });
  return (
    <>
      <div
        className="trow"
        {...rowContext(() => [
          { label: 'Add a device here…', icon: 'plus', disabled: !canEdit, run: () => newDevice(m, { site: s.name, room: r.name }) },
          { separator: true },
          { label: 'Take the room out', icon: 'trash', danger: true, disabled: !canEdit, run: () => void workDid(call<string>('remove-row', s.path, 'rooms', r.row, r.name)) },
        ])}
      >
        <button type="button" onClick={onToggle} className="t" title={r.name} aria-expanded={open} style={{ border: 0, background: 'none', padding: 0, font: 'inherit', fontWeight: 600, color: 'inherit', cursor: 'pointer', textAlign: 'left' }}>
          {r.name}
          {r.purpose || r.floor ? ` · ${[r.purpose, r.floor].filter(Boolean).join(' · ')}` : ''}
        </button>
        <span className="end">
          <span className="meta">{`${ds.length} ${ds.length === 1 ? 'device' : 'devices'} · ${pts.length} ${pts.length === 1 ? 'point' : 'points'}`}{due ? ' ·' : ''}</span>
          {/* Only due work earns a tag (p15, Nov 2026): the counts already say devices and points. */}
          {due ? <span className="tag amber">{`${due} to patch`}</span> : null}
        </span>
      </div>
      {open && (
        <div style={{ padding: '4px 0 10px 26px' }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 13 }}>
            <span>
              Room <Inline value={r.name} label="Room" canEdit={canEdit} onSave={cellSave('title')} />
            </span>
            <span>
              Floor <Inline value={r.floor} label="Floor" placeholder="Floor" canEdit={canEdit} onSave={cellSave('floor')} />
            </span>
            <span>
              For <Inline value={r.purpose} label="Purpose" placeholder="What it’s for" canEdit={canEdit} onSave={cellSave('purpose')} />
            </span>
          </div>
          {ds.length ? (
            <ul className="wm-devs">
              {ds.map((d) => (
                <DeviceRow key={d.path} d={d} m={m} canEdit={canEdit} here />
              ))}
            </ul>
          ) : (
            <p className="vsub">No devices in this room.</p>
          )}
        </div>
      )}
    </>
  );
}

/** "30 Jun 27" for a warranty's end day. */
const warrantyShort = (iso: string) => `${shortDay(iso)} ${iso.slice(2, 4)}`;

function SiteDeviceTrow({ d, m, canEdit }: { d: Device; m: SitesView; canEdit: boolean }) {
  const open = () => peek({ type: 'note', path: d.path }, { title: d.name, type: 'note' });
  const what = [d.make, d.model].filter(Boolean).join(' ');
  return (
    <div className="trow" {...rowContext(() => deviceMenu(d, m, canEdit))}>
      <span className="gtile xs slate" aria-hidden="true">
        ▦
      </span>
      <button type="button" onClick={open} className="t" title={d.name} style={{ border: 0, background: 'none', padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer', textAlign: 'left' }}>
        {d.name}
        {what ? ` · ${what}` : ''}
      </button>
      <span className="end">
        <span className="meta">{[d.serial || d.assetTag, d.warranty ? `warranty to ${warrantyShort(d.warranty)}` : d.assigned ? `${d.assigned}’s care` : d.room].filter(Boolean).join(' · ')}</span>
      </span>
    </div>
  );
}

/** One patch point: its state first, then what it feeds; opened, every cell changes where it shows. */
function SitePatchRow({ s, x, canEdit, open, onToggle }: { s: Site; x: PatchPoint; canEdit: boolean; open: boolean; onToggle(): void }) {
  const live = x.status === 'Live';
  const markLive = () => void save({ kind: 'patch', path: s.path, row: x.row, title: x.point, field: 'status', value: 'Live' });
  const title = x.device ? `${x.point} · ${x.device}` : x.point;
  // The state is said once (p15, Nov 2026): the tag says Live or To patch, so the meta only adds news (a note, a day).
  const meta = live ? (x.date ? `mapped ${shortDay(x.date)}` : '') : [x.notes, x.date ? (x.days !== null && x.days >= 0 && x.days <= 7 ? weekdayOf(x.date) : shortDay(x.date)) : x.dateWords].filter(Boolean).join(' ') || '';
  const set = (field: string) => (v: string) => save({ kind: 'patch', path: s.path, row: x.row, title: x.point, field, value: v });
  return (
    <>
      <div
        className="trow"
        {...rowContext(() => [
          ...(!live ? [{ label: 'Mark live', icon: 'check' as const, disabled: !canEdit, run: markLive }] : []),
          { label: 'Open its note', icon: 'notes' as const, run: () => A.openPath(s.path, { where: 'tab' }) },
          { separator: true as const },
          { label: 'Take it out', icon: 'trash' as const, danger: true, disabled: !canEdit, run: () => void workDid(call<string>('remove-row', s.path, 'patch', x.row, x.point)) },
        ])}
      >
        {!live ? (
          <button type="button" className="tag amber" style={{ border: 0, cursor: 'pointer', font: 'inherit' }} disabled={!canEdit} onClick={markLive} title="It’s patched and working: mark it live">
            {x.status || 'To patch'}
          </button>
        ) : (
          <span className="tag green">Live</span>
        )}
        <button type="button" onClick={onToggle} className="t" title={title} aria-expanded={open} style={{ border: 0, background: 'none', padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer', textAlign: 'left' }}>
          {title}
        </button>
        <span className="end">{meta ? <span className="meta">{meta}</span> : null}</span>
      </div>
      {open && (
        <div style={{ padding: '4px 0 10px 26px' }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 13 }}>
            <span>
              Point <Inline value={x.point} label="Point" canEdit={canEdit} onSave={set('title')} />
            </span>
            <span>
              Room <Inline value={x.room} label="Room" kind="choice" options={['', ...s.rooms.map((r) => r.name)]} canEdit={canEdit} onSave={set('room')} />
            </span>
            <span>
              Switch <Inline value={x.switch} label="Switch" canEdit={canEdit} onSave={set('switch')} />
            </span>
            <span>
              Port <Inline value={x.port} label="Port" canEdit={canEdit} onSave={set('port')} />
            </span>
            <span>
              VLAN <Inline value={x.vlan} label="VLAN" canEdit={canEdit} onSave={set('vlan')} />
            </span>
            <span>
              Device <Inline value={x.device} label="Device" canEdit={canEdit} onSave={set('device')} />
            </span>
            <span>
              Date <Inline value={x.date ?? x.dateWords} shown={x.date ? dayText(x.date) : x.dateWords} label="Date" kind="date" canEdit={canEdit} onSave={set('date')} />
            </span>
            <span>
              Status <Inline value={x.status} label="Status" kind="choice" options={['', ...PATCH_STATUSES]} canEdit={canEdit} onSave={set('status')} />
            </span>
            <span>
              Note <Inline value={x.notes} label="Note" placeholder="Add" canEdit={canEdit} onSave={set('notes')} />
            </span>
          </div>
        </div>
      )}
    </>
  );
}

function SitePage({ s, m, canEdit }: { s: Site; m: SitesView; canEdit: boolean }) {
  const modules = useModules();
  const patchOn = partOn(modules, 'sites', 'patch');
  const [openRooms, setOpenRooms] = useState<Set<number>>(new Set());
  const [openPatch, setOpenPatch] = useState<Set<number>>(new Set());
  const all = m.devices.filter((d) => d.sitePath === s.path);
  const here = all.filter((d) => d.status !== 'Retired');
  const retired = all.filter((d) => d.status === 'Retired');
  const live = s.patch.filter((p) => p.status === 'Live').length;
  const todo = s.patch.filter((p) => p.status !== 'Live').length;
  const panels = [...new Set(s.patch.map((p) => p.switch).filter(Boolean))];
  const panel = panels.length === 1 ? panels[0] : null;
  const photos = here.reduce((n, d) => n + d.photos.length, 0);
  const prop = (field: string) => (v: string) => save({ kind: 'site', path: s.path, field, value: v });
  const toggle = (row: number) => setOpenRooms((t) => (t.has(row) ? new Set([...t].filter((x) => x !== row)) : new Set([...t, row])));
  const togglePatch = (row: number) => setOpenPatch((t) => (t.has(row) ? new Set([...t].filter((x) => x !== row)) : new Set([...t, row])));
  const where = [s.kind, s.code].filter(Boolean).join(' ');
  // The sub says what the site keeps, never zeros (p15, Nov 2026): the photos sentence only while devices could hold them.
  const stockParts = [s.rooms.length ? plural(s.rooms.length, 'room') : '', here.length ? plural(here.length, 'device') : '', patchOn && s.patch.length ? (panel ? `patch ${panel} mapped` : `${live} of ${s.patch.length} patch points live`) : ''].filter(Boolean);
  const stockLine = stockParts.join(', ');
  const photoLine = photos ? (here.length > 0 && here.every((d) => d.photos.length) ? 'Photos with each device.' : `${plural(photos, 'photo')} with its devices.`) : here.length ? 'No photos with its devices yet.' : '';
  const stockSub = stockLine && photoLine ? `${stockLine}. ${photoLine}` : stockLine ? `${stockLine}.` : photoLine || 'Nothing kept yet.';
  return (
    <PackShell
      glyph="▦"
      tint="slate"
      title={where ? `${s.name} · ${where}` : s.name}
      sub={stockSub}
      facts={[
        ...(s.rooms.length ? [{ k: 'Rooms', v: s.rooms.map((r) => r.name).filter(Boolean).join(' · ') || `${plural(s.rooms.length, 'room')}` }] : []),
        ...(patchOn && s.patch.length
          ? [
              {
                k: 'Patch',
                v: (
                  <>
                    <span className="pill green">{`${live} live`}</span>
                    {todo ? <span className="pill amber">{`${todo} to patch`}</span> : null}
                  </>
                ),
              },
            ]
          : []),
      ]}
      actions={
        <button type="button" className="btn pri" disabled={!canEdit} onClick={() => newDevice(m, { site: s.name })}>
          + New device
        </button>
      }
      sharePath={s.path}
      menu={() => [
        { label: packName('sites', 'Sites'), icon: 'server', run: () => openModule('sites', 'overview') },
        { label: SITES.sections.find((x) => x.id === 'sites')?.label ?? 'Sites', icon: 'pin', run: () => openModule('sites', 'sites') },
        { separator: true },
        { label: 'Add a room', icon: 'grid', disabled: !canEdit, run: () => newRoom(s) },
        { label: 'Add a patch point', icon: 'branch', disabled: !canEdit || !patchOn, run: () => newPatch(s, m) },
        { label: 'Add photos…', icon: 'image', disabled: !canEdit, run: () => void addPhotos(s.path, s.name) },
        { label: 'Export the patch schedule (CSV)…', icon: 'download', disabled: !s.patch.length, run: () => void workDid(call<string | null>('export-patch-csv', s.path), (f) => (f ? `Saved ${f.split(/[\\/]/).pop()}.` : '')) },
        { separator: true },
        { label: 'Open its note', icon: 'notes', run: () => A.openPath(s.path, { where: 'tab' }) },
        { label: 'Delete', icon: 'trash', danger: true, disabled: !canEdit, run: () => void A.trashPath(s.path).catch(showError) },
      ]}
    >
      <PackSection label="Devices">
        {here.length ? (
          here.map((d) => <SiteDeviceTrow key={d.path} d={d} m={m} canEdit={canEdit} />)
        ) : (
          <p className="vsub">No devices here yet.</p>
        )}
        {retired.length > 0 && (
          <details className="wm-retired">
            <summary>{plural(retired.length, 'retired device')} kept on record</summary>
            <ul className="wm-devs">
              {retired.map((d) => (
                <DeviceRow key={d.path} d={d} m={m} canEdit={canEdit} />
              ))}
            </ul>
          </details>
        )}
      </PackSection>
      {patchOn && (
        <PackSection label={panel ? `Patch points · ${panel}` : 'Patch points'}>
          {s.patch.length ? (
            s.patch.map((x) => <SitePatchRow key={x.row} s={s} x={x} canEdit={canEdit} open={openPatch.has(x.row)} onToggle={() => togglePatch(x.row)} />)
          ) : (
            <p className="vsub">No patch points yet. Add each outlet with its switch port to plan the patching and export it for the installer.</p>
          )}
        </PackSection>
      )}
      <PackSection label="Rooms">
        {s.rooms.length ? (
          s.rooms.map((r) => <SiteRoomRow key={r.row} s={s} r={r} m={m} canEdit={canEdit} open={openRooms.has(r.row)} onToggle={() => toggle(r.row)} />)
        ) : (
          <p className="vsub">No rooms yet. Add the comms room, the shop floor or the offices to place devices in them.</p>
        )}
      </PackSection>
      <PackSection label="Photos">
        {s.photos.length ? (
          <>
            <ul className="wm-photos">
              {s.photos.slice(0, 12).map((p) => (
                <li key={p}>
                  <SitePhoto p={p} />
                </li>
              ))}
            </ul>
            <p className="vsub" style={{ marginTop: 8 }}>
              {plural(s.photos.length, 'photo')} kept with {s.name}.
            </p>
          </>
        ) : (
          <p className="vsub">Keep photos of the racks, the floor plan or the shopfront with the site.</p>
        )}
        {s.files.length > s.photos.length && <p className="wm-faint wm-other-files">{plural(s.files.length - s.photos.length, 'other file')} kept with it.</p>}
      </PackSection>
      <PackSection label="Details" pad>
        <div className="prow">
          <span className="k">Kind</span>
          <span className="v">
            <Inline value={s.kind} label="Kind" kind="choice" options={[...SITE_KINDS]} canEdit={canEdit} onSave={prop('site_kind')} />
          </span>
        </div>
        <div className="prow">
          <span className="k">Code</span>
          <span className="v">
            <Inline value={s.code} label="Code" placeholder="Add a code" canEdit={canEdit} onSave={prop('code')} />
          </span>
        </div>
        <div className="prow">
          <span className="k">Address</span>
          <span className="v">
            <Inline value={s.address} label="Address" placeholder="Add the address" canEdit={canEdit} onSave={prop('address')} />
          </span>
        </div>
        <div className="prow">
          <span className="k">Status</span>
          <span className="v">
            <Inline value={s.status} shown={<Pill tone={statusTone(s.status)}>{s.status}</Pill>} label="Status" kind="choice" options={[...SITE_STATUSES]} canEdit={canEdit} onSave={prop('status')} />
          </span>
        </div>
        <div className="prow">
          <span className="k">Project</span>
          <span className="v">
            <Inline value={s.project} label="Project" kind="choice" options={['', ...m.projects.map((p) => p.name)]} placeholder="Link a project" canEdit={canEdit} onSave={prop('project')} />
          </span>
        </div>
        <div className="prow">
          <span className="k">Contact</span>
          <span className="v">
            <Inline value={s.contact} label="Contact" kind="choice" options={['', ...m.people]} placeholder="Choose someone" canEdit={canEdit} onSave={prop('contact')} />
          </span>
        </div>
      </PackSection>
      <AskFloat question={(w) => `About ${s.name} in Sites: ${w}`} />
    </PackShell>
  );
}

/** Every Sites page and action in the one menu, so nothing is more than a tap away. */
function sitesMenu(m: SitesView | null, canEdit: boolean): MenuItem[] {
  if (!m) return [];
  const name = packName('sites', 'Sites');
  const sitesLabel = SITES.sections.find((s) => s.id === 'sites')?.label ?? 'Sites';
  return [
    { label: name, icon: 'server', run: () => openModule('sites', 'overview') },
    { label: sitesLabel, icon: 'pin', run: () => openModule('sites', 'sites') },
    { label: 'Inventory', icon: 'computer', run: () => openModule('sites', 'inventory') },
    { label: 'Patch schedule', icon: 'branch', run: () => openModule('sites', 'patch') },
    { label: 'Warranty and end of life', icon: 'clock', run: () => openModule('sites', 'lifecycle') },
    { separator: true },
    { label: 'New site', icon: 'pin', disabled: !canEdit, run: () => newSite(m) },
    { label: 'New device', icon: 'computer', disabled: !canEdit, run: () => newDevice(m) },
    { label: 'New patch point', icon: 'branch', disabled: !canEdit, run: () => newPatch(null, m) },
    { separator: true },
    { label: `${name} options…`, icon: 'settings', disabled: !canEdit, run: () => sitesOptions(m.remindDays) },
    { label: 'Show the folder', icon: 'folder', run: () => A.revealInExplorer(m.folder) },
    { separator: true },
    { label: `Show me around ${name}`, icon: 'help', run: () => openTour('sites') },
  ];
}

// ── The page ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const STATUS_FILTERS = [
  { id: 'all', label: 'All devices' },
  { id: 'In use', label: 'In use' },
  { id: 'Spare', label: 'Spare pool' },
  { id: 'On order', label: 'On order' },
  { id: 'In repair', label: 'In repair' },
  { id: 'Retired', label: 'Retired' },
];

export function SitesPage({ tab }: { tab: W.TabState }) {
  const canEdit = useApp((s) => s.canEdit);
  const modules = useModules();
  const sections = SITES.sections.filter((s) => (s.id !== 'patch' || partOn(modules, 'sites', 'patch')) && (s.id !== 'lifecycle' || partOn(modules, 'sites', 'lifecycle')));
  const { section, detail } = placeOf(tab, SITES, sections);
  const { data: m, error } = useWork<SitesView>('sites');
  const records = useMemo(() => (m ? siteRecords(m) : []), [m]);
  const [status, setStatus] = useState('all');
  const ctx = useWorkCtx('sites', records, {
    editable: (r) => SITE_EDITABLE[r.kind] ?? [],
    people: m?.people ?? [],
    open: (r: WsRecord, e) => {
      if (!r.path) return;
      if (e?.ctrlKey || e?.metaKey) return A.openPath(r.path, { where: 'tab' });
      if (r.kind === 'device') return peek({ type: 'note', path: r.path }, { title: r.title, type: 'note' });
      openSite(r.path);
    },
  });
  const site = detail?.kind === 'site' && m ? m.sites.find((s) => s.path === siteKey(detail.key)) : undefined;
  const info = sections.find((s) => s.id === section) ?? SITES.sections[0];
  const add = section === 'sites' ? { label: 'New site', run: () => newSite(m) } : section === 'patch' && m?.sites.length ? { label: 'New patch point', run: () => newPatch(null, m) } : { label: 'New device', run: () => newDevice(m) };
  const empty = m && !m.sites.length && !m.devices.length;
  const inventory = status === 'all' ? records : records.filter((r) => r.kind !== 'device' || r.fields.status === status);
  // The 8.7 pages stand in the module's own scope (p15, Nov 2026): work-sites.css is written under .wm-sites, and
  // without it the cards, chips, inline edits and photo grid render unstyled. The classic shell carried it; PackShell
  // does not, so the page carries it.
  return (
    <div className="wm-sites">
    <WithRecords ctx={ctx}>
      {error ? (
        <div className="nv-page full p87">
          <p className="rm-failed">{error}</p>
        </div>
      ) : !m ? (
        <div className="nv-page full p87">
          <div className="view-loading" />
        </div>
      ) : detail ? (
        site ? (
          <SitePage s={site} m={m} canEdit={canEdit} />
        ) : (
          <PackShell glyph="▦" tint="slate" title="That site isn’t here any more" sub="It may have been renamed, moved or taken out." menu={() => sitesMenu(m, canEdit)}>
            <p>
              <button type="button" className="btn" onClick={() => openModule('sites', 'sites')}>
                All sites
              </button>
            </p>
          </PackShell>
        )
      ) : empty && section === 'overview' ? (
        <PackShell glyph="▦" tint="slate" title={packName('sites', 'Sites')} sub="Rooms, gear, serials, patch points and photos for each site." menu={() => sitesMenu(m, canEdit)}>
          <EmptyState icon="server" title="Your sites and equipment, in one register" line="Add a site to keep its rooms, patch points, devices and photos together, and a device with its serial to know where it is and when its warranty ends." action={{ label: 'Add your first site', icon: 'plus', run: () => newSite(m), disabled: !canEdit }} also={{ label: 'Add a device', icon: 'computer', run: () => newDevice(m), disabled: !canEdit }} />
        </PackShell>
      ) : section === 'overview' ? (
        <Overview m={m} canEdit={canEdit} />
      ) : (
        <PackShell
          glyph="▦"
          tint="slate"
          title={info.label}
          sub={info.line}
          actions={
            <button type="button" className="btn pri" disabled={!canEdit} onClick={add.run}>
              + {add.label}
            </button>
          }
          menu={() => sitesMenu(m, canEdit)}
        >
          {section === 'sites' ? (
            <div className="rm-overview">
              {m.sites.length ? (
                <ul className="wm-sitecards">
                  {m.sites.map((s) => (
                    <SiteCard key={s.path} s={s} />
                  ))}
                </ul>
              ) : (
                <EmptyState size="panel" icon="pin" title="No sites yet" line="Add an office, store, warehouse or venue." action={{ label: 'New site', icon: 'plus', run: () => newSite(m), disabled: !canEdit }} />
              )}
              {m.sites.length > 0 && <WorkViews module="sites" section="sites" made={siteSectionViews('sites')} records={records} />}
            </div>
          ) : section === 'inventory' ? (
            <div className="rm-overview">
              <div className="wm-chips" role="group" aria-label="Show devices">
                {STATUS_FILTERS.map((f) => {
                  const n = f.id === 'all' ? m.devices.length : m.devices.filter((d) => d.status === f.id).length;
                  if (f.id !== 'all' && !n && status !== f.id) return null;
                  return (
                    <button key={f.id} type="button" className={`wm-chip${status === f.id ? ' is-on' : ''}`} aria-pressed={status === f.id} onClick={() => setStatus(f.id)}>
                      {f.label} <span className="wm-chip-n">{n}</span>
                    </button>
                  );
                })}
              </div>
              <WorkViews module="sites" section="inventory" made={siteSectionViews('inventory')} records={inventory} />
            </div>
          ) : (
            <WorkViews module="sites" section={section} made={siteSectionViews(section)} records={records} />
          )}
        </PackShell>
      )}
    </WithRecords>
    </div>
  );
}

// ── Today ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export function SitesToday() {
  const modules = useModules();
  const life = partOn(modules, 'sites', 'lifecycle');
  const patch = partOn(modules, 'sites', 'patch');
  const { data: m } = useWork<SitesView>('sites', 'model', [], life || patch);
  if (!m) return null;
  const items = life ? m.lifecycle.filter((l) => l.days <= Math.min(m.remindDays, 30) && !(l.what === 'warranty' && l.days < -7)) : [];
  const patching = patch ? m.toPatch.filter((x) => x.days !== null && x.days <= 7) : [];
  if (!items.length && !patching.length) return null;
  return (
    <section className="td-section rm-today wm-sites-today" data-section="sites" aria-labelledby="td-h-sites">
      <header className="td-section-head">
        <h2 id="td-h-sites">
          Sites and equipment
          <span className="td-count">{items.length + patching.length}</span>
        </h2>
        <button type="button" className="td-section-link" onClick={() => openModule('sites')}>
          <Icon name="server" size={13} /> Sites
        </button>
      </header>
      <ul className="rm-today-rows">
        {patching.map((x) => (
          <li key={`p:${x.site}:${x.row}`} className={`rm-today-row${x.days! < 0 ? ' is-late' : ''}`}>
            <button type="button" className="rm-today-main" onClick={() => openSite(x.site)}>
              <span className="rm-today-name">
                Patch {x.point} at {x.siteName}
              </span>
              <span className="rm-today-sub">{[x.days === 0 ? 'Today' : x.days! < 0 ? `${plural(-x.days!, 'day')} overdue` : `${dayText(x.date)} · in ${x.days} days`, x.room, x.switch && x.port ? `${x.switch} port ${x.port}` : ''].filter(Boolean).join(' · ')}</span>
            </button>
          </li>
        ))}
        {items.map((l) => (
          <li key={`l:${l.device.path}:${l.what}`} className={`rm-today-row${l.days < 0 ? ' is-late' : ' is-change'}`}>
            <button type="button" className="rm-today-main" onClick={() => peek({ type: 'note', path: l.device.path }, { title: l.device.name, type: 'note' })}>
              <span className="rm-today-name">{l.device.name}</span>
              <span className="rm-today-sub">{[l.words, l.device.site].filter(Boolean).join(' · ')}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
