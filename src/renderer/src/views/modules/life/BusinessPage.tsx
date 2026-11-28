// Business's page (Wave 7 part b; src/shared/business.ts, src/main/life-records/business.ts): a business of the person's
// own. The Overview: open support most urgent first, the latest releases, live campaigns and how the sites are. The
// release log by month; customers with what they bring in; campaigns on a board you drag between; support from new to
// solved; each site's checks and renewal days. Every release, customer, campaign, support item and site has its own page
// where every value changes where it shows.

import { useMemo, useState } from 'react';
import { BUSINESS, CAMPAIGN_CHANNELS, CAMPAIGN_STATUSES, CUSTOMER_PERIODS, CUSTOMER_STATUSES, POST_STATUSES, RELEASE_STATUSES, SUPPORT_CHANNELS, SUPPORT_PRIORITIES, WEBSITE_KINDS, WEBSITE_STATUSES } from '../../../../../shared/life-records';
import { BUSINESS_EDITABLE, businessRecords, businessSectionViews, businessWeek, renewalWords, type BusinessModel, type Campaign, type Customer, type Post, type Release, type SupportItem, type Website } from '../../../../../shared/business';
import { partOn } from '../../../../../shared/life-modules';
import { EmptyState } from '../../../components/EmptyState';
import { Icon } from '../../../components/Icon';
import type { MenuItem } from '../../../components/Menu';
import { initials } from '../../../lib/projectLook';
import * as A from '../../../state/actions';
import { draftInChat } from '../../../state/chat';
import { openTour } from '../../../state/moduleFills';
import { openModule, useModules } from '../../../state/modules';
import { showError, useApp } from '../../../state/store';
import { useWork, workCall, workDid } from '../../../state/workModules';
import type * as W from '../../../state/workspace';
import { openRecordForm, valueWords } from '../RecordForm';
import { moneyText, setRecordCurrency } from '../../workspace/recordParts';
import { moneyWords } from '../../../../../shared/personal-records';
import { Card, dayText, inDays, openDetail, Pill, placeOf, Tile, useWorkCtx, WithRecords, WorkViews } from '../work/WorkShell';
import { AskFloat, PackSection, PackShell, Tick, checkedWords, packName, rowContext, rowMenu, shortDay, weekdayOf, type Tint } from '../pack87';
import { Fact, hostOf, hrefOf, Inline, QuickAdd, saved, StatusChip } from './parts';

type BusinessView = BusinessModel & { folder: string };

const call = <T,>(name: string, ...args: unknown[]) => workCall<T>('business', name, ...args);
const open = (kind: string, rel: string) => openDetail('business', kind, rel);
const set = (kind: string, rel: string, field: string) => (v: string) => saved(call('set-field', { kind, path: rel, field, value: v }));
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthWords = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const tone = (s: string): 'ok' | 'warn' | 'bad' | undefined => (/^(up|released|active|live|solved|closed|done|posted)$/i.test(s) ? 'ok' : /^(slow|waiting|trial|paused|planned|in progress|scheduled|high)$/i.test(s) ? 'warn' : /^(down|urgent|churned|pulled|dropped)$/i.test(s) ? 'bad' : undefined);
const nextOf = (list: readonly string[], s: string) => list[(list.indexOf(s) + 1) % list.length];
const SUPPORT_NEXT: Record<string, string> = { New: 'Open', Open: 'Solved', Waiting: 'Open', Solved: 'Closed', Closed: 'Open' };

// ── Forms ────────────────────────────────────────────────────────────────────────────────────────────────────────────

function newRelease(m: BusinessView | null): void {
  const products = [...new Set(m?.releases.map((r) => r.product).filter(Boolean) ?? [])];
  openRecordForm({
    title: 'Log a release',
    icon: 'flag',
    line: 'A version that went out (or is about to), with what changed.',
    ok: 'Log it',
    fields: [
      { key: 'product', label: 'Product', kind: 'choice', options: ['', ...products], value: products[0] ?? '', own: true },
      { key: 'version', label: 'Version', kind: 'text', required: true, placeholder: '2.4.0' },
      { key: 'date', label: 'Day', kind: 'date' },
      { key: 'status', label: 'Status', kind: 'choice', options: [...RELEASE_STATUSES], value: 'Released' },
      { key: 'changes', label: 'What changed', kind: 'text', wide: true, placeholder: 'Faster search; New export; Fixed the login loop', hint: 'Separate them with ;. Add more on its page.' },
    ],
    submit: async (v) => {
      const product = valueWords(v, 'product');
      const version = valueWords(v, 'version');
      const rel = await call<string>('add-release', { name: product ? `${product} ${version}` : version, product, version, date: valueWords(v, 'date'), status: valueWords(v, 'status'), changes: valueWords(v, 'changes') });
      await workDid(Promise.resolve(rel), `Logged ${product ? `${product} ` : ''}${version}.`, { label: 'Open', run: () => open('release', rel) });
    },
  });
}

function newCustomer(): void {
  openRecordForm({
    title: 'New customer',
    icon: 'person',
    line: 'Someone who buys from you: their plan, what they pay and when it renews.',
    ok: 'Add the customer',
    fields: [
      { key: 'name', label: 'Customer', kind: 'text', required: true, wide: true, placeholder: 'Harbour Cafe' },
      { key: 'contact', label: 'Contact', kind: 'text' },
      { key: 'email', label: 'Email', kind: 'text' },
      { key: 'plan', label: 'Plan', kind: 'text', placeholder: 'Pro' },
      { key: 'status', label: 'Status', kind: 'choice', options: [...CUSTOMER_STATUSES], value: 'Active' },
      { key: 'value', label: 'What they pay', kind: 'money' },
      { key: 'period', label: 'How often', kind: 'segment', options: [...CUSTOMER_PERIODS], value: 'Monthly' },
      { key: 'renews', label: 'Renews', kind: 'date' },
      { key: 'source', label: 'Came from', kind: 'text', placeholder: 'LinkedIn post' },
    ],
    submit: async (v) => {
      const rel = await call<string>('add-customer', Object.fromEntries(['name', 'contact', 'email', 'plan', 'status', 'value', 'period', 'renews', 'source'].map((k) => [k, valueWords(v, k)])));
      await workDid(Promise.resolve(rel), `Added ${valueWords(v, 'name')}.`, { label: 'Open', run: () => open('customer', rel) });
    },
  });
}

function newCampaign(): void {
  openRecordForm({
    title: 'New campaign',
    icon: 'bolt',
    line: 'A marketing push: where it runs, when, what it should do, and its posts.',
    ok: 'Add the campaign',
    fields: [
      { key: 'name', label: 'Campaign', kind: 'text', required: true, wide: true, placeholder: 'Spring launch' },
      { key: 'channel', label: 'Channel', kind: 'choice', options: [...CAMPAIGN_CHANNELS], value: 'LinkedIn' },
      { key: 'status', label: 'Status', kind: 'choice', options: [...CAMPAIGN_STATUSES], value: 'Idea' },
      { key: 'starts', label: 'Starts', kind: 'date' },
      { key: 'ends', label: 'Ends', kind: 'date' },
      { key: 'goal', label: 'Goal', kind: 'text', wide: true, placeholder: '20 trial sign-ups' },
      { key: 'budget', label: 'Budget', kind: 'money' },
    ],
    submit: async (v) => {
      const rel = await call<string>('add-campaign', Object.fromEntries(['name', 'channel', 'status', 'starts', 'ends', 'goal', 'budget'].map((k) => [k, valueWords(v, k)])));
      await workDid(Promise.resolve(rel), `Added the campaign ${valueWords(v, 'name')}.`, { label: 'Open', run: () => open('campaign', rel) });
    },
  });
}

function newSupport(m: BusinessView | null, customer?: string): void {
  openRecordForm({
    title: 'New support item',
    icon: 'chat',
    line: 'A customer’s question or problem, followed from new to solved.',
    ok: 'Add it',
    fields: [
      { key: 'name', label: 'In a few words', kind: 'text', required: true, wide: true, placeholder: 'Can’t sign in after the update' },
      { key: 'customer', label: 'Customer', kind: 'choice', options: ['', ...(m?.customers.map((c) => c.name) ?? [])], value: customer ?? '', own: true },
      { key: 'priority', label: 'Priority', kind: 'segment', options: [...SUPPORT_PRIORITIES], value: 'Normal' },
      { key: 'channel', label: 'Came by', kind: 'choice', options: [...SUPPORT_CHANNELS], value: 'Email' },
      { key: 'product', label: 'Product', kind: 'text' },
      { key: 'version', label: 'Version', kind: 'text' },
      { key: 'said', label: 'What they said', kind: 'text', wide: true },
    ],
    submit: async (v) => {
      const rel = await call<string>('add-support', Object.fromEntries(['name', 'customer', 'priority', 'channel', 'product', 'version', 'said'].map((k) => [k, valueWords(v, k)])));
      await workDid(Promise.resolve(rel), `Added ${valueWords(v, 'name')}.`, { label: 'Open', run: () => open('ticket', rel) });
    },
  });
}

function newWebsite(): void {
  openRecordForm({
    title: 'New website',
    icon: 'globe',
    line: 'A site, shop or service of the business: its health checks and when its domain and certificate renew.',
    ok: 'Add the site',
    fields: [
      { key: 'name', label: 'Name', kind: 'text', required: true, placeholder: 'Main site' },
      { key: 'url', label: 'Address', kind: 'text', placeholder: 'https://example.com' },
      { key: 'kind', label: 'Kind', kind: 'choice', options: [...WEBSITE_KINDS], value: 'Website' },
      { key: 'host', label: 'Hosted with', kind: 'text' },
      { key: 'domain_renews', label: 'Domain renews', kind: 'date' },
      { key: 'cert_expires', label: 'Certificate expires', kind: 'date' },
    ],
    submit: async (v) => {
      const rel = await call<string>('add-website', Object.fromEntries(['name', 'url', 'kind', 'host', 'domain_renews', 'cert_expires'].map((k) => [k, valueWords(v, k)])));
      await workDid(Promise.resolve(rel), `Added ${valueWords(v, 'name')}.`, { label: 'Open', run: () => open('website', rel) });
    },
  });
}

function checkForm(w: Website): void {
  openRecordForm({
    title: `Check ${w.name}`,
    icon: 'globe',
    line: 'How it was when you looked. Today unless you change the day.',
    ok: 'Note the check',
    fields: [
      { key: 'status', label: 'It was', kind: 'segment', options: ['Up', 'Slow', 'Down'], value: 'Up' },
      { key: 'response', label: 'Response', kind: 'text', placeholder: '320 ms' },
      { key: 'date', label: 'Day', kind: 'date' },
      { key: 'note', label: 'Note', kind: 'text', wide: true },
    ],
    submit: async (v) => {
      await workDid(call<string>('add-check', w.path, { status: valueWords(v, 'status'), response: valueWords(v, 'response'), date: valueWords(v, 'date'), note: valueWords(v, 'note') }));
    },
  });
}

// ── Pieces ───────────────────────────────────────────────────────────────────────────────────────────────────────────

function SupportRow({ s, canEdit, today }: { s: SupportItem; canEdit: boolean; today: string }) {
  return (
    <li className={`rm-row${s.priority === 'Urgent' ? ' is-late' : ''}`}>
      <button type="button" className="rm-row-main" onClick={() => open('ticket', s.path)}>
        <span className="rm-row-icon" aria-hidden="true">
          <Icon name="chat" size={14} />
        </span>
        <span className="rm-row-words">
          <span className="rm-row-name">{s.name}</span>
          <span className="rm-row-sub">{[s.customer, s.received && (s.age === 0 ? 'came in today' : `came in ${inDays(s.received, today)}`), s.product && `${s.product}${s.version ? ` ${s.version}` : ''}`].filter(Boolean).join(' · ')}</span>
        </span>
      </button>
      <span className="rm-row-end">
        {s.priority !== 'Normal' && <Pill tone={tone(s.priority)}>{s.priority}</Pill>}
        <StatusChip status={s.status} next={SUPPORT_NEXT[s.status]} canEdit={canEdit} onSet={(v) => void saved(call('set-field', { kind: 'ticket', path: s.path, field: 'status', value: v }))} />
      </span>
    </li>
  );
}

function ReleaseCard({ r, today }: { r: Release; today: string }) {
  return (
    <li className="lr-release">
      <button type="button" className="lr-release-head" onClick={() => open('release', r.path)}>
        <span className="lr-version">{r.version}</span>
        <span className="lr-release-words">
          <span className="lr-release-name">{r.product || 'Release'}</span>
          <span className="lr-release-sub">{[r.date ? dayText(r.date) : 'No day', r.date && inDays(r.date, today)].filter(Boolean).join(' · ')}</span>
        </span>
        {r.status !== 'Released' && <Pill tone={tone(r.status)}>{r.status}</Pill>}
      </button>
      {r.changes.length > 0 && (
        <ul className="lr-changes">
          {r.changes.slice(0, 4).map((c, i) => (
            <li key={i}>{c}</li>
          ))}
          {r.changes.length > 4 && <li className="lr-faint">and {r.changes.length - 4} more</li>}
        </ul>
      )}
    </li>
  );
}

function SiteCard({ w, today, canEdit, renewals }: { w: Website; today: string; canEdit: boolean; renewals: BusinessView['renewals'] }) {
  const href = hrefOf(w.url);
  const checks = [...w.checks].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  const mine = renewals.filter((r) => r.site.path === w.path);
  return (
    <li className={`lr-site tone-${tone(w.status) ?? 'none'}`}>
      <div className="lr-site-head">
        <button type="button" className="lr-site-title" onClick={() => open('website', w.path)}>
          <span className={`lr-dot tone-${tone(w.status) ?? 'none'}`} />
          <span className="lr-site-name">{w.name}</span>
          <span className="lr-site-status">{w.status === 'Unknown' ? 'Not checked yet' : w.status}</span>
        </button>
        <button type="button" className="button small" disabled={!canEdit} onClick={() => void workDid(call<string>('site-check', w.path))} title="Visit its address now and write what was found">
          <Icon name="check" size={12} /> Check now
        </button>
        <button type="button" className="button small" disabled={!canEdit} onClick={() => checkForm(w)} title="Write down a check you made yourself">
          Note a check
        </button>
      </div>
      {href && (
        <a className="lr-site-url" href={href} target="_blank" rel="noreferrer">
          <Icon name="external" size={11} /> {hostOf(href)}
        </a>
      )}
      <div className="lr-site-facts">
        <span>{w.checked ? `Checked ${dayText(w.checked)}` : 'Never checked'}</span>
        {w.domainRenews && !mine.some((r) => r.what === 'domain') && <span>Domain renews {dayText(w.domainRenews)}</span>}
        {w.certExpires && !mine.some((r) => r.what === 'certificate') && <span>Certificate to {dayText(w.certExpires)}</span>}
      </div>
      {mine.map((r) => (
        <p key={r.what} className={`lr-renew${r.days < 0 ? ' is-late' : ''}`}>
          <Icon name="clock" size={12} /> {renewalWords(r, today)}
        </p>
      ))}
      {checks.length > 0 && (
        <span className="lr-site-strip" aria-label="The last checks">
          <span className="lr-faint lr-strip-label">{checks.length === 1 ? 'Last check' : `Last ${Math.min(14, checks.length)} checks`}</span>
          {checks
            .slice(0, 14)
            .reverse()
            .map((c) => (
              <span key={c.row} className={`lr-tick tone-${tone(c.status) ?? 'none'}`} title={`${c.date ? dayText(c.date) : ''}: ${c.status}${c.response ? `, ${c.response}` : ''}${c.note ? ` · ${c.note}` : ''}`} />
            ))}
        </span>
      )}
    </li>
  );
}

// ── Overview ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const tintOf = (s: string): Tint => (tone(s) === 'ok' ? 'green' : tone(s) === 'warn' ? 'amber' : tone(s) === 'bad' ? 'red' : 'slate');

function ReleaseRow({ r }: { r: Release }) {
  const shipped = r.status === 'Released';
  // The product leads: version numbers alone say nothing when the business has more than one product.
  const name = r.product ? `${r.product} ${r.version}` : r.version;
  // A release not shipped yet qualifies its changes (packs uplift item 15): planned work never reads as shipped.
  const words = r.changes.length ? `${shipped ? '' : 'planned: '}${r.changes.slice(0, 2).join(', ')}` : r.product || 'Release';
  const go = () => open('release', r.path);
  return (
    <div className="trow" {...rowContext(() => rowMenu(r.path, `release ${r.version}`, go))}>
      <span className={`gtile xs ${shipped ? 'green' : 'amber'}`} aria-hidden="true">
        ◧
      </span>
      <button type="button" onClick={go} className="t" title={`${name} · ${words}`} style={{ border: 0, background: 'none', padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer', textAlign: 'left' }}>
        {name} · {words}
      </button>
      <span className="end">
        <span className="meta">{r.date ? (shipped ? `shipped ${weekdayOf(r.date)}` : `due ${shortDay(r.date)}`) : shipped ? 'shipped' : 'no day'} ·</span>
        <span className={`tag ${shipped ? 'green' : 'amber'}`}>{shipped ? 'Live' : r.status}</span>
      </span>
    </div>
  );
}

function CustomerRow({ c }: { c: Customer }) {
  const renewsSoon = c.renews && c.renewsDays !== null && c.renewsDays <= 14 && c.renewsDays >= 0;
  const go = () => open('customer', c.path);
  return (
    <div className="trow" {...rowContext(() => rowMenu(c.path, c.name, go))}>
      {/* Every row starts with the one tile slot, so every row's words share one left edge. */}
      <span className={`gtile xs ${renewsSoon ? 'amber' : 'slate'}`} aria-hidden="true">
        ○
      </span>
      <button type="button" onClick={go} className="t" title={c.name} style={{ border: 0, background: 'none', padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer', textAlign: 'left' }}>
        {c.name}{c.plan ? ` · ${c.plan}` : ''}
      </button>
      <span className="end">
        {renewsSoon && c.renews ? <span className="tag amber">renews {weekdayOf(c.renews)}</span> : c.value !== null ? <span className="tag slate">{moneyText(c.value)} / {c.period === 'Monthly' ? 'mo' : c.period === 'Yearly' ? 'yr' : c.period.toLowerCase()}</span> : null}
      </span>
    </div>
  );
}

function SupportTrow({ s }: { s: SupportItem }) {
  const tint: Tint = s.priority === 'Urgent' ? 'red' : s.priority === 'High' ? 'amber' : 'slate';
  const go = () => open('ticket', s.path);
  return (
    <div className="trow" {...rowContext(() => rowMenu(s.path, s.name, go))}>
      <span className={`gtile xs ${tint}`} aria-hidden="true">
        !
      </span>
      <button type="button" onClick={go} className="t" title={s.name} style={{ border: 0, background: 'none', padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer', textAlign: 'left' }}>
        {s.name}
      </button>
      <span className="end">
        <span className={`tag ${tint}`}>{s.priority}</span>
      </span>
    </div>
  );
}

function WebsiteTrow({ w, today }: { w: Website; today: string }) {
  const down = w.status === 'Down';
  const unknown = w.status === 'Unknown' || !w.status;
  // The row says the site's own name; its address stays one hover away.
  const host = hrefOf(w.url) ? hostOf(hrefOf(w.url)!) : '';
  const go = () => open('website', w.path);
  return (
    <div className="trow" {...rowContext(() => rowMenu(w.path, w.name, go))}>
      <span className={`gtile xs ${down ? 'red' : unknown ? 'slate' : 'green'}`} aria-hidden="true">
        ●
      </span>
      <button type="button" onClick={go} className="t" title={host ? `${w.name} · ${host}` : w.name} style={{ border: 0, background: 'none', padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer', textAlign: 'left' }}>
        {w.name} · {down ? 'down' : unknown ? 'not checked yet' : 'up'}
      </button>
      <span className="end">
        {!down && !unknown && (w.certExpires || w.domainRenews) ? <span className="meta">{[w.certExpires ? `cert ${shortDay(w.certExpires)}` : null, w.domainRenews ? `domain ${shortDay(w.domainRenews)}` : null].filter(Boolean).join(' · ')}</span> : null}
        {down && w.checked ? <span className="meta">since {checkedWords(w.checked, today).toLowerCase()} ·</span> : null}
        {unknown ? <span className="tag slate">Not checked yet</span> : down ? <button type="button" className="tag red" style={{ border: 0, cursor: 'pointer', font: 'inherit' }} onClick={() => open('website', w.path)} title={`Open ${w.name} to check it again`}>Fix</button> : null}
      </span>
    </div>
  );
}

function Overview({ m, canEdit }: { m: BusinessView; canEdit: boolean }) {
  const modules = useModules();
  const supportOn = partOn(modules, 'business', 'support');
  const sitesOn = partOn(modules, 'business', 'sites');
  const week = businessWeek(m);
  const shipped = week.releases.filter((r) => r.status === 'Released');
  const liveCount = m.campaigns.filter((c) => c.status === 'Live').length;
  const active = m.customers.filter((c) => c.status === 'Active');
  const customers = [...active].sort((a, b) => (a.renews ?? '9999').localeCompare(b.renews ?? '9999')).slice(0, 4);
  // This week's shipped releases, then what is being built next.
  const log = [...shipped, ...m.releases.filter((r) => r.status !== 'Released')].slice(0, 4);
  const shippedWords = (r: Release) => (r.product ? `${r.product} ${r.version}` : r.version);
  const weekWords = [shipped.length ? `Release ${shipped.map(shippedWords).join(', ')} shipped` : null, liveCount ? `${liveCount} ${liveCount === 1 ? 'campaign' : 'campaigns'} live` : 'No campaigns live'].filter(Boolean).join(' · ');
  const lastChecked = m.websites.map((w) => w.checked ?? '').filter(Boolean).sort().slice(-1)[0] ?? null;
  // An empty section that says nothing is not shown; support keeps its one quiet line, but only once support exists.
  const showReleases = log.length > 0;
  const showCustomers = customers.length > 0;
  const showSupport = supportOn && m.support.length > 0;
  const showSites = sitesOn && m.websites.length > 0;
  const customersSection = showCustomers && (
    <PackSection label="Customers">
      {customers.map((c) => (
        <CustomerRow key={c.path} c={c} />
      ))}
    </PackSection>
  );
  const supportSection = showSupport && (
    <PackSection label="Support" bare={!m.openSupport.length}>
      {m.openSupport.length ? (
        m.openSupport.slice(0, 4).map((s) => <SupportTrow key={s.path} s={s} />)
      ) : (
        <p className="vsub">Every support item is solved.</p>
      )}
    </PackSection>
  );
  return (
    <PackShell
      glyph="◧"
      tint="blue"
      title={packName('business', 'Business')}
      sub="Releases, customers, campaigns, support and site health."
      facts={[
        { k: 'This week', v: weekWords || 'Nothing shipped yet' },
        ...(supportOn
          ? [
              {
                k: 'Needs you',
                v: m.openSupport.length > 0 ? <span className="pill red">{`${m.openSupport.length} support open`}</span> : <span className="pill green">Support clear</span>,
              },
            ]
          : []),
      ]}
      actions={
        <button type="button" className="btn pri" disabled={!canEdit} onClick={() => newRelease(m)}>
          + Log a release
        </button>
      }
      menu={() => businessMenu(m, canEdit)}
    >
      {showReleases && (
        <PackSection label="Release log · this week">
          {log.map((r) => (
            <ReleaseRow key={r.path} r={r} />
          ))}
        </PackSection>
      )}
      {(showCustomers || showSupport) &&
        (showCustomers && showSupport ? (
          <div className="p87-cols">
            <div>{customersSection}</div>
            <div>{supportSection}</div>
          </div>
        ) : (
          <>
            {customersSection}
            {supportSection}
          </>
        ))}
      {showSites && (
        <PackSection label={`Websites checked · ${lastChecked ? checkedWords(lastChecked, m.today) : 'Never'}`}>
          {m.websites.map((w) => (
            <WebsiteTrow key={w.path} w={w} today={m.today} />
          ))}
        </PackSection>
      )}
    </PackShell>
  );
}

// ── Records' own pages ───────────────────────────────────────────────────────────────────────────────────────────────

function ReleasePage({ r, canEdit }: { r: Release; canEdit: boolean }) {
  const href = hrefOf(r.link);
  return (
    <div className="lr-detail">
      <div className="lr-detail-main">
        <Card id="changes" title="What changed" count={r.changes.length}>
          {r.changes.length ? (
            <ul className="lr-steps">
              {r.changes.map((c, i) => (
                <li key={i} className="lr-step">
                  <span className="lr-bullet" aria-hidden="true" />
                  <span className="lr-step-text">
                    <Inline value={c} label={`Change ${i + 1}`} canEdit={canEdit} onSave={(v) => saved(call('changes', r.path, { at: i, words: v }))} />
                  </span>
                  <button type="button" className="icon-button small" aria-label="Take this change out" title="Take it out" disabled={!canEdit} onClick={() => void workDid(call<string>('changes', r.path, { remove: i }))}>
                    <Icon name="trash" size={12} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rm-none">Nothing written yet. Add each change below.</p>
          )}
          <QuickAdd compact placeholder="Add a change and press Enter" canEdit={canEdit} onAdd={(w) => saved(call('changes', r.path, { add: w }))} />
        </Card>
      </div>
      <aside className="lr-detail-side">
        <Card id="details" title="Details">
          <div className="lr-facts">
            <Fact label="Product">
              <Inline value={r.product} label="Product" placeholder="Add" canEdit={canEdit} onSave={set('release', r.path, 'product')} />
            </Fact>
            <Fact label="Version">
              <Inline value={r.version} label="Version" canEdit={canEdit} onSave={set('release', r.path, 'version')} />
            </Fact>
            <Fact label="Day">
              <Inline value={r.date ?? ''} shown={r.date ? dayText(r.date) : undefined} label="Day" kind="date" placeholder="Add" canEdit={canEdit} onSave={set('release', r.path, 'date')} />
            </Fact>
            <Fact label="Status">
              <Inline value={r.status} shown={<Pill tone={tone(r.status)}>{r.status}</Pill>} label="Status" kind="choice" options={[...RELEASE_STATUSES]} canEdit={canEdit} onSave={set('release', r.path, 'status')} />
            </Fact>
            <Fact label="Link" wide>
              <span className="lr-link-cell">
                <Inline value={r.link} shown={href ? hostOf(href) : r.link} label="Link" placeholder="Add the release notes’ link" canEdit={canEdit} onSave={set('release', r.path, 'link')} />
                {href && (
                  <a className="icon-button small" href={href} target="_blank" rel="noreferrer" aria-label="Open the link">
                    <Icon name="external" size={12} />
                  </a>
                )}
              </span>
            </Fact>
          </div>
        </Card>
      </aside>
    </div>
  );
}

function CustomerPage({ c, m, canEdit }: { c: Customer; m: BusinessView; canEdit: boolean }) {
  const support = m.support.filter((s) => s.customerPath === c.path);
  const f = (label: string, field: string, value: string, extra: Partial<Parameters<typeof Inline>[0]> = {}) => (
    <Fact label={label}>
      <Inline value={value} label={label} placeholder="Add" canEdit={canEdit} onSave={set('customer', c.path, field)} {...extra} />
    </Fact>
  );
  return (
    <div className="lr-detail">
      <div className="lr-detail-main">
        <Card id="support" title="Support" count={support.length} actions={canEdit ? <button type="button" className="text-button" onClick={() => newSupport(m, c.name)}><Icon name="plus" size={12} /> Add</button> : undefined}>
          {support.length ? (
            <ul className="rm-rows">
              {support.map((s) => (
                <SupportRow key={s.path} s={s} canEdit={canEdit} today={m.today} />
              ))}
            </ul>
          ) : (
            <p className="rm-none">No support items from {c.name}.</p>
          )}
        </Card>
      </div>
      <aside className="lr-detail-side">
        <Card id="details" title="Details">
          <div className="lr-facts">
            {f('Status', 'status', c.status, { kind: 'choice', options: [...CUSTOMER_STATUSES], shown: <Pill tone={tone(c.status)}>{c.status}</Pill> })}
            {f('Plan', 'plan', c.plan)}
            {f('What they pay', 'pays', c.value !== null ? String(c.value) : '', { kind: 'number', shown: c.value !== null ? moneyText(c.value) : undefined })}
            {f('How often', 'period', c.period, { kind: 'choice', options: [...CUSTOMER_PERIODS] })}
            {f('Customer since', 'since', c.since ?? '', { kind: 'date', shown: c.since ? dayText(c.since) : undefined })}
            {f('Renews', 'renews', c.renews ?? '', { kind: 'date', shown: c.renews ? `${dayText(c.renews)} · ${inDays(c.renews, m.today)}` : undefined })}
            {f('Contact', 'contact', c.contact)}
            {f('Email', 'email', c.email)}
            {f('Came from', 'source', c.source)}
          </div>
          {c.monthly > 0 && <p className="lr-hint">Brings in about {moneyText(Math.round(c.monthly * 100) / 100)} a month.</p>}
        </Card>
      </aside>
    </div>
  );
}

function CampaignPage({ c, canEdit }: { c: Campaign; canEdit: boolean }) {
  const setPost = (p: Post, values: Record<string, unknown>) => saved(call('set-post', c.path, p.row, p.title, values));
  const f = (label: string, field: string, value: string, extra: Partial<Parameters<typeof Inline>[0]> = {}) => (
    <Fact label={label}>
      <Inline value={value} label={label} placeholder="Add" canEdit={canEdit} onSave={set('campaign', c.path, field)} {...extra} />
    </Fact>
  );
  return (
    <div className="lr-detail">
      <div className="lr-detail-main">
        <Card id="posts" title="Posts" count={c.posts.length}>
          {c.posts.length ? (
            <div className="lr-table-wrap">
              <table className="lr-table">
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>What</th>
                    <th>Day</th>
                    <th>Channel</th>
                    <th>Link</th>
                    <th aria-label="More" />
                  </tr>
                </thead>
                <tbody>
                  {c.posts.map((p) => (
                    <tr key={p.row} className={/^posted$/i.test(p.status) ? 'is-done' : ''}>
                      <td className="lr-td-status">
                        <StatusChip status={p.status || 'Draft'} next={nextOf(POST_STATUSES, p.status || 'Draft')} canEdit={canEdit} onSet={(v) => void setPost(p, { status: v })} />
                      </td>
                      <td className="lr-td-title">
                        <Inline value={p.title} label="What" canEdit={canEdit} onSave={(v) => setPost(p, { title: v })} />
                      </td>
                      <td>
                        <Inline value={p.date ?? ''} shown={p.date ? dayText(p.date) : undefined} label="Day" kind="date" placeholder="Add" canEdit={canEdit} onSave={(v) => setPost(p, { date: v })} />
                      </td>
                      <td>
                        <Inline value={p.channel} label="Channel" kind="choice" options={['', ...CAMPAIGN_CHANNELS]} placeholder="Add" canEdit={canEdit} onSave={(v) => setPost(p, { channel: v })} />
                      </td>
                      <td className="lr-td-link">
                        <span className="lr-link-cell">
                          <Inline value={p.link} shown={hrefOf(p.link) ? hostOf(hrefOf(p.link)!) : p.link} label="Link" placeholder="Add" canEdit={canEdit} onSave={(v) => setPost(p, { link: v })} />
                          {hrefOf(p.link) && (
                            <a className="icon-button small" href={hrefOf(p.link)!} target="_blank" rel="noreferrer" aria-label="Open the post">
                              <Icon name="external" size={12} />
                            </a>
                          )}
                        </span>
                      </td>
                      <td className="lr-td-end">
                        <button type="button" className="icon-button small" aria-label={`Take ${p.title || 'the post'} out`} title="Take it out" disabled={!canEdit} onClick={() => void workDid(call<string>('remove-post', c.path, p.row, p.title))}>
                          <Icon name="trash" size={12} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="rm-none">No posts yet. Add each post with its day to plan the campaign.</p>
          )}
          <QuickAdd compact placeholder="Add a post and press Enter" canEdit={canEdit} onAdd={(w) => workDid(call<string>('add-post', c.path, { title: w, channel: c.channel })).then((r) => r !== null)} />
        </Card>
      </div>
      <aside className="lr-detail-side">
        <Card id="details" title="Details">
          <div className="lr-facts">
            {f('Status', 'status', c.status, { kind: 'choice', options: [...CAMPAIGN_STATUSES], shown: <Pill tone={tone(c.status)}>{c.status}</Pill> })}
            {f('Channel', 'channel', c.channel, { kind: 'choice', options: ['', ...CAMPAIGN_CHANNELS] })}
            {f('Starts', 'starts', c.starts ?? '', { kind: 'date', shown: c.starts ? dayText(c.starts) : undefined })}
            {f('Ends', 'ends', c.ends ?? '', { kind: 'date', shown: c.ends ? dayText(c.ends) : undefined })}
            {f('Goal', 'goal', c.goal)}
            {f('Budget', 'budget', c.budget !== null ? String(c.budget) : '', { kind: 'number', shown: c.budget !== null ? moneyText(c.budget) : undefined })}
            {f('Result', 'result', c.result)}
          </div>
        </Card>
      </aside>
    </div>
  );
}

function SupportPage({ s, m, canEdit }: { s: SupportItem; m: BusinessView; canEdit: boolean }) {
  const customer = m.customers.find((c) => (s.customerPath && c.path === s.customerPath) || (s.customer && c.name === s.customer)) ?? null;
  const tint: Tint = s.priority === 'Urgent' ? 'red' : s.priority === 'High' ? 'amber' : 'slate';
  const next = SUPPORT_NEXT[s.status] ?? 'Open';
  const first = (s.customer || '').trim().split(/\s+/)[0] || 'them';
  const advanceWords = s.status === 'New' ? 'Start work on it' : s.status === 'Open' ? 'Mark it solved' : s.status === 'Waiting' ? 'Mark it open again' : s.status === 'Solved' ? 'Close it' : 'Open it again';
  return (
    <PackShell
      glyph="◧"
      tint={tint}
      title={s.name}
      sub={`From ${s.customer || 'a customer'}${s.channel ? `, by ${s.channel.toLowerCase()}` : ''}${s.received ? ` ${inDays(s.received, m.today)}` : ''}.`}
      sharePath={s.path}
      facts={[
        { k: 'Status', v: <span className={`pill ${tint}`}>{s.priority !== 'Normal' ? `${s.priority} · ${s.status.toLowerCase()}` : s.status}</span> },
        ...(s.customer
          ? [
              {
                k: 'Customer',
                v: (
                  <>
                    <i className="miniava blue" aria-hidden="true">
                      {initials(s.customer)}
                    </i>
                    {s.customer}
                    {customer?.plan ? ` · ${customer.plan}` : ''}
                    {customer?.value !== null && customer?.value !== undefined ? ` · ${moneyText(customer.value)} / ${customer.period === 'Monthly' ? 'mo' : customer.period === 'Yearly' ? 'yr' : customer.period.toLowerCase()}` : ''}
                  </>
                ),
              },
            ]
          : []),
        ...([s.product, s.version].filter(Boolean).length ? [{ k: 'About', v: [s.product, s.version ? `version ${s.version}` : null].filter(Boolean).join(' · ') }] : []),
      ]}
      menu={() => [
        { label: packName('business', 'Business'), icon: 'chart', run: () => openModule('business', 'overview') },
        { label: 'Support', icon: 'chat', run: () => openModule('business', 'support') },
        { separator: true },
        { label: 'Open its note', icon: 'notes', run: () => A.openPath(s.path, { where: 'tab' }) },
        ...(customer ? [{ label: `Open ${customer.name}`, icon: 'person' as const, run: () => open('customer', customer.path) }] : []),
        { separator: true },
        { label: 'Delete', icon: 'trash', danger: true, disabled: !canEdit, run: () => void A.trashPath(s.path).catch(showError) },
      ]}
    >
      <PackSection label="Thread" pad>
        <p style={{ fontSize: 14 }}>
          <b>{s.customer || 'They'}:</b> <Inline value={s.said} label="What they said" kind="long" placeholder="Paste or write what the customer said" canEdit={canEdit} onSave={(v) => saved(call('support-words', s.path, 'said', v))} className="lr-why" />
        </p>
        <p style={{ fontSize: 14, marginTop: 8 }}>
          <b>You:</b> <Inline value={s.did} label="What we did" kind="long" placeholder="Write what you did or answered" canEdit={canEdit} onSave={(v) => saved(call('support-words', s.path, 'did', v))} className="lr-why" />
        </p>
      </PackSection>
      <PackSection label="Next">
        <div className="trow">
          <Tick label={`${advanceWords} (${next})`} onTick={() => void saved(call('set-field', { kind: 'ticket', path: s.path, field: 'status', value: next }))} />
          <span className="t">{advanceWords}</span>
          <span className="end">
            <span className={`tag ${tintOf(next)}`}>{next}</span>
          </span>
        </div>
        <div className="trow">
          <span className="t">Reply to {first} with the all-clear</span>
          <span className="end">
            <button
              type="button"
              className="tag blue"
              style={{ border: 0, cursor: 'pointer', font: 'inherit' }}
              onClick={() => draftInChat(`Draft a reply to ${s.customer || 'the customer'} about "${s.name}". What they said: ${s.said || 'nothing yet'}. What we did: ${s.did || 'nothing yet'}.`, s.path)}
              title="Draft the reply in the assistant"
            >
              Draft
            </button>
          </span>
        </div>
      </PackSection>
      <PackSection label="Details">
        <div className="prow">
          <span className="k">Priority</span>
          <span className="v">
            <Inline value={s.priority} shown={<Pill tone={tone(s.priority)}>{s.priority}</Pill>} label="Priority" kind="choice" options={[...SUPPORT_PRIORITIES]} canEdit={canEdit} onSave={set('ticket', s.path, 'priority')} />
          </span>
        </div>
        <div className="prow">
          <span className="k">Came in</span>
          <span className="v">
            <Inline value={s.received ?? ''} shown={s.received ? `${dayText(s.received)} · ${inDays(s.received, m.today)}` : undefined} label="Came in" kind="date" placeholder="Add" canEdit={canEdit} onSave={set('ticket', s.path, 'received')} />
          </span>
        </div>
        <div className="prow">
          <span className="k">Came by</span>
          <span className="v">
            <Inline value={s.channel} label="Came by" kind="choice" options={['', ...SUPPORT_CHANNELS]} canEdit={canEdit} onSave={set('ticket', s.path, 'channel')} />
          </span>
        </div>
      </PackSection>
      <AskFloat hint={`Draft a reply to ${first}…`} question={(w) => `About the support item "${s.name}" from ${s.customer || 'a customer'}: ${w}`} />
    </PackShell>
  );
}

/** Every Business page and action in the one menu, so nothing is more than a tap away. */
function businessMenu(m: BusinessView | null, canEdit: boolean): MenuItem[] {
  if (!m) return [];
  const name = packName('business', 'Business');
  return [
    { label: name, icon: 'chart', run: () => openModule('business', 'overview') },
    { label: 'Release log', icon: 'flag', run: () => openModule('business', 'releases') },
    { label: 'Customers', icon: 'people', run: () => openModule('business', 'customers') },
    { label: 'Campaigns', icon: 'bolt', run: () => openModule('business', 'campaigns') },
    { label: 'Support', icon: 'chat', run: () => openModule('business', 'support') },
    { label: 'Website health', icon: 'globe', run: () => openModule('business', 'sites') },
    { separator: true },
    { label: 'Log a release', icon: 'flag', disabled: !canEdit, run: () => newRelease(m) },
    { label: 'New customer', icon: 'person', disabled: !canEdit, run: () => newCustomer() },
    { label: 'New campaign', icon: 'bolt', disabled: !canEdit, run: () => newCampaign() },
    { label: 'New support item', icon: 'chat', disabled: !canEdit, run: () => newSupport(m) },
    { label: 'New website', icon: 'globe', disabled: !canEdit, run: () => newWebsite() },
    { separator: true },
    { label: 'Show the folder', icon: 'folder', run: () => A.revealInExplorer(m.folder) },
    { separator: true },
    { label: `Show me around ${name}`, icon: 'help', run: () => openTour('business') },
  ];
}

function WebsitePage({ w, m, canEdit }: { w: Website; m: BusinessView; canEdit: boolean }) {
  const href = hrefOf(w.url);
  const checks = [...w.checks].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  const f = (label: string, field: string, value: string, extra: Partial<Parameters<typeof Inline>[0]> = {}) => (
    <Fact label={label}>
      <Inline value={value} label={label} placeholder="Add" canEdit={canEdit} onSave={set('website', w.path, field)} {...extra} />
    </Fact>
  );
  return (
    <div className="lr-detail">
      <div className="lr-detail-main">
        <Card id="checks" title="Checks" count={w.checks.length} actions={canEdit ? <button type="button" className="text-button" onClick={() => checkForm(w)}><Icon name="plus" size={12} /> Note a check</button> : undefined}>
          {m.renewals
            .filter((r) => r.site.path === w.path)
            .map((r) => (
              <p key={r.what} className={`lr-renew${r.days < 0 ? ' is-late' : ''}`}>
                <Icon name="clock" size={12} /> {renewalWords(r, m.today)}
              </p>
            ))}
          {checks.length ? (
            <ul className="lr-health">
              {checks.slice(0, 20).map((c) => (
                <li key={c.row} className="lr-health-row">
                  <span className="lr-health-date">{c.date ? dayText(c.date) : 'No date'}</span>
                  {c.status ? <Pill tone={tone(c.status)}>{c.status}</Pill> : <span />}
                  <span className="lr-health-note">{[c.response, c.note].filter(Boolean).join(' · ')}</span>
                  <span />
                </li>
              ))}
            </ul>
          ) : (
            <p className="rm-none">Not checked yet. Note how it was each time you look.</p>
          )}
        </Card>
      </div>
      <aside className="lr-detail-side">
        <Card id="details" title="Details">
          <div className="lr-facts">
            {f('Status', 'status', w.status, { kind: 'choice', options: [...WEBSITE_STATUSES], shown: <Pill tone={tone(w.status)}>{w.status}</Pill> })}
            <Fact label="Address" wide>
              <span className="lr-link-cell">
                <Inline value={w.url} label="Address" placeholder="Add" canEdit={canEdit} onSave={set('website', w.path, 'url')} className="lr-mono" />
                {href && (
                  <a className="icon-button small" href={href} target="_blank" rel="noreferrer" aria-label={`Open ${hostOf(href)}`}>
                    <Icon name="external" size={12} />
                  </a>
                )}
              </span>
            </Fact>
            {f('Kind', 'site_kind', w.kind, { kind: 'choice', options: [...WEBSITE_KINDS] })}
            {f('Hosted with', 'host', w.host)}
            {f('Domain renews', 'domain_renews', w.domainRenews ?? '', { kind: 'date', shown: w.domainRenews ? `${dayText(w.domainRenews)} · ${inDays(w.domainRenews, m.today)}` : undefined })}
            {f('Certificate expires', 'cert_expires', w.certExpires ?? '', { kind: 'date', shown: w.certExpires ? `${dayText(w.certExpires)} · ${inDays(w.certExpires, m.today)}` : undefined })}
            {f('Last checked', 'checked', w.checked ?? '', { kind: 'date', shown: w.checked ? dayText(w.checked) : undefined })}
          </div>
        </Card>
      </aside>
    </div>
  );
}

// ── The page ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** One of the pack's inner pages around its kept content. */
function BusinessSection({ m, canEdit, label, line, add, children }: { m: BusinessView; canEdit: boolean; label: string; line: string; add: { label: string; run(): void }; children: React.ReactNode }) {
  return (
    <PackShell
      glyph="◧"
      tint="blue"
      title={label}
      sub={line}
      actions={
        <button type="button" className="btn pri" disabled={!canEdit} onClick={add.run}>
          + {add.label}
        </button>
      }
      menu={() => businessMenu(m, canEdit)}
    >
      {children}
    </PackShell>
  );
}

/** A record's own page around its kept content, with its note and Delete in the menu. */
function DetailShell({ canEdit, title, line, path, children }: { canEdit: boolean; title: string; line: string; path: string; children: React.ReactNode }) {
  return (
    <PackShell
      glyph="◧"
      tint="blue"
      title={title}
      sub={line}
      sharePath={path}
      menu={() => [
        { label: packName('business', 'Business'), icon: 'chart', run: () => openModule('business', 'overview') },
        { separator: true },
        { label: 'Open its note', icon: 'notes', run: () => A.openPath(path, { where: 'tab' }) },
        { separator: true },
        { label: 'Delete', icon: 'trash', danger: true, disabled: !canEdit, run: () => void A.trashPath(path).catch(showError) },
      ]}
    >
      {children}
    </PackShell>
  );
}

export function BusinessPage({ tab }: { tab: W.TabState }) {
  const canEdit = useApp((s) => s.canEdit);
  const modules = useModules();
  const sections = BUSINESS.sections.filter((s) => (s.id !== 'support' || partOn(modules, 'business', 'support')) && (s.id !== 'sites' || partOn(modules, 'business', 'sites')));
  const { section, detail } = placeOf(tab, BUSINESS, sections);
  const { data: m, error } = useWork<BusinessView>('business');
  if (m) setRecordCurrency(m.currency);
  const records = useMemo(() => (m ? businessRecords(m) : []), [m]);
  const [show, setShow] = useState<'open' | 'waiting' | 'done' | 'all'>('open');
  const ctx = useWorkCtx('business', records, { editable: (r) => BUSINESS_EDITABLE[r.kind] ?? [], open: (r) => r.path && open(r.kind, r.path) });
  const find = (kind: string) => (!m || detail?.kind !== kind ? undefined : kind === 'release' ? m.releases.find((x) => x.path === detail.key) : kind === 'customer' ? m.customers.find((x) => x.path === detail.key) : kind === 'campaign' ? m.campaigns.find((x) => x.path === detail.key) : kind === 'ticket' ? m.support.find((x) => x.path === detail.key) : m.websites.find((x) => x.path === detail.key));
  const rec = detail ? find(detail.kind) : undefined;
  const ADD: Record<string, { label: string; run(): void }> = {
    overview: { label: 'Log a release', run: () => newRelease(m) },
    releases: { label: 'Log a release', run: () => newRelease(m) },
    customers: { label: 'New customer', run: () => newCustomer() },
    campaigns: { label: 'New campaign', run: () => newCampaign() },
    support: { label: 'New support item', run: () => newSupport(m, detail?.kind === 'customer' && rec ? (rec as Customer).name : undefined) },
    sites: { label: 'New website', run: () => newWebsite() },
  };
  const add = ADD[section] ?? ADD.overview;
  const info = sections.find((s) => s.id === section) ?? BUSINESS.sections[0];
  const empty = m && !m.releases.length && !m.customers.length && !m.campaigns.length && !m.support.length && !m.websites.length;
  const supportShown = m ? m.support.filter((s) => (show === 'open' ? s.open && s.status !== 'Waiting' : show === 'waiting' ? s.status === 'Waiting' : show === 'done' ? !s.open : true)) : [];
  const byMonth = m ? [...new Set(m.releases.map((r) => r.date?.slice(0, 7) ?? ''))] : [];
  const detailHead =
    rec && detail
      ? {
          title: detail.kind === 'release' ? `${(rec as Release).product ? `${(rec as Release).product} ` : ''}${(rec as Release).version}` : (rec as { name: string }).name,
          line:
            detail.kind === 'customer'
              ? [(rec as Customer).plan, (rec as Customer).value !== null && `${moneyText((rec as Customer).value!)} ${(rec as Customer).period.toLowerCase()}`].filter(Boolean).join(' · ')
              : detail.kind === 'campaign'
                ? [(rec as Campaign).channel, (rec as Campaign).goal].filter(Boolean).join(' · ')
                : detail.kind === 'website'
                  ? (rec as Website).url
                  : (rec as Release).date
                    ? dayText((rec as Release).date)
                    : '',
        }
      : null;
  return (
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
        !rec ? (
          <PackShell glyph="◧" tint="blue" title="That isn’t here any more" sub="It may have been renamed, moved or taken out." menu={() => businessMenu(m, canEdit)}>
            <p>
              <button type="button" className="btn" onClick={() => openModule('business', 'overview')}>
                {packName('business', 'Business')}
              </button>
            </p>
          </PackShell>
        ) : detail.kind === 'ticket' ? (
          <SupportPage s={rec as SupportItem} m={m} canEdit={canEdit} />
        ) : detail.kind === 'release' ? (
          <DetailShell canEdit={canEdit} title={detailHead!.title} line={detailHead!.line} path={(rec as Release).path}>
            <ReleasePage r={rec as Release} canEdit={canEdit} />
          </DetailShell>
        ) : detail.kind === 'customer' ? (
          <DetailShell canEdit={canEdit} title={detailHead!.title} line={detailHead!.line} path={(rec as Customer).path}>
            <CustomerPage c={rec as Customer} m={m} canEdit={canEdit} />
          </DetailShell>
        ) : detail.kind === 'campaign' ? (
          <DetailShell canEdit={canEdit} title={detailHead!.title} line={detailHead!.line} path={(rec as Campaign).path}>
            <CampaignPage c={rec as Campaign} canEdit={canEdit} />
          </DetailShell>
        ) : (
          <DetailShell canEdit={canEdit} title={detailHead!.title} line={detailHead!.line} path={(rec as Website).path}>
            <WebsitePage w={rec as Website} m={m} canEdit={canEdit} />
          </DetailShell>
        )
      ) : empty && section === 'overview' ? (
        <PackShell glyph="◧" tint="blue" title={packName('business', 'Business')} sub="Releases, customers, campaigns, support and site health." menu={() => businessMenu(m, canEdit)}>
          <EmptyState icon="chart" title="Your business in one place" line="Log each release with what changed, keep customers with what they pay, plan campaigns on a board, follow support from new to solved, and keep an eye on your sites and their renewals." action={{ label: 'Log a release', icon: 'plus', run: () => newRelease(m), disabled: !canEdit }} also={{ label: 'Add a customer', icon: 'person', run: () => newCustomer(), disabled: !canEdit }} />
        </PackShell>
      ) : section === 'overview' ? (
        <Overview m={m} canEdit={canEdit} />
      ) : (
        <BusinessSection m={m} canEdit={canEdit} label={info.label} line={info.line} add={add}>
          {section === 'releases' ? (
            <div className="rm-overview">
              {m.releases.length ? (
                byMonth.map((ym) => (
                  <section key={ym || 'none'} className="lr-month-group">
                    <h3 className="lr-group-head">{ym ? monthWords(ym) : 'No day'}</h3>
                    <ul className="lr-releases">
                      {m.releases
                        .filter((r) => (r.date?.slice(0, 7) ?? '') === ym)
                        .map((r) => (
                          <ReleaseCard key={r.path} r={r} today={m.today} />
                        ))}
                    </ul>
                  </section>
                ))
              ) : (
                <EmptyState size="panel" icon="flag" title="No releases yet" line="Log each version with its day and what changed." action={{ label: 'Log a release', icon: 'plus', run: () => newRelease(m), disabled: !canEdit }} />
              )}
              {m.releases.length > 1 && <WorkViews module="business" section="releases" made={businessSectionViews('releases')} records={records} />}
            </div>
          ) : section === 'customers' ? (
            <div className="rm-overview">
              <div className="rm-tiles">
                {CUSTOMER_STATUSES.map((st) => (
                  <Tile key={st} icon="people" label={st} value={String(m.customers.filter((c) => c.status === st).length)} sub={st === 'Active' && m.monthly ? `${moneyWords(Math.round(m.monthly), m.currency)} a month` : st === 'Trial' ? 'trying it' : st === 'Churned' ? 'left' : ' '} />
                ))}
              </div>
              <WorkViews module="business" section="customers" made={businessSectionViews('customers')} records={records} />
            </div>
          ) : section === 'campaigns' ? (
            <div className="rm-overview">
              {m.postsDue.length > 0 && (
                <Card id="due" title="Posts due" count={m.postsDue.length}>
                  <ul className="rm-rows">
                    {m.postsDue.map((p) => (
                      <li key={`${p.campaign}:${p.row}`} className="rm-row">
                        <button type="button" className="rm-row-main" onClick={() => open('campaign', p.campaign)}>
                          <span className="rm-row-icon" aria-hidden="true">
                            <Icon name="chat" size={14} />
                          </span>
                          <span className="rm-row-words">
                            <span className="rm-row-name">{p.title || 'A post'}</span>
                            <span className="rm-row-sub">{[p.campaignName, p.channel, p.date && dayText(p.date)].filter(Boolean).join(' · ')}</span>
                          </span>
                        </button>
                        <span className="rm-row-end">
                          <button type="button" className="button small" disabled={!canEdit} onClick={() => void saved(call('set-post', p.campaign, p.row, p.title, { status: 'Posted' }), `${p.title || 'The post'} is out.`)}>
                            <Icon name="check" size={12} /> Posted
                          </button>
                        </span>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
              <WorkViews module="business" section="campaigns" made={businessSectionViews('campaigns')} records={records} />
            </div>
          ) : section === 'support' ? (
            <div className="rm-overview">
              <div className="lr-chips" role="group" aria-label="Show support items">
                {(
                  [
                    ['open', 'Open', m.support.filter((s) => s.open && s.status !== 'Waiting').length],
                    ['waiting', 'Waiting on them', m.support.filter((s) => s.status === 'Waiting').length],
                    ['done', 'Solved and closed', m.support.filter((s) => !s.open).length],
                    ['all', 'Everything', m.support.length],
                  ] as const
                ).map(([id, label, n]) => (
                  <button key={id} type="button" className={`lr-filter${show === id ? ' is-on' : ''}`} aria-pressed={show === id} onClick={() => setShow(id)}>
                    {label} <span className="lr-filter-n">{n}</span>
                  </button>
                ))}
              </div>
              <Card id="support-list" title={show === 'open' ? 'Open, most urgent first' : show === 'waiting' ? 'Waiting on the customer' : show === 'done' ? 'Solved and closed' : 'Every support item'} count={supportShown.length}>
                {supportShown.length ? (
                  <ul className="rm-rows">
                    {(show === 'open' ? m.openSupport.filter((s) => s.status !== 'Waiting') : supportShown).map((s) => (
                      <SupportRow key={s.path} s={s} canEdit={canEdit} today={m.today} />
                    ))}
                  </ul>
                ) : (
                  <p className="rm-none">Nothing here.</p>
                )}
              </Card>
            </div>
          ) : (
            <div className="rm-overview">
              {m.websites.length ? (
                <ul className="lr-sites">
                  {m.websites.map((w) => (
                    <SiteCard key={w.path} w={w} today={m.today} canEdit={canEdit} renewals={m.renewals} />
                  ))}
                </ul>
              ) : (
                <EmptyState size="panel" icon="globe" title="No websites yet" line="Add a site to keep its health checks and renewal days." action={{ label: 'New website', icon: 'plus', run: () => newWebsite(), disabled: !canEdit }} />
              )}
            </div>
          )}
        </BusinessSection>
      )}
    </WithRecords>
  );
}

// ── Today ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export function BusinessToday() {
  const modules = useModules();
  const supportOn = partOn(modules, 'business', 'support');
  const sitesOn = partOn(modules, 'business', 'sites');
  const { data: m } = useWork<BusinessView>('business');
  if (!m) return null;
  const support = supportOn ? m.openSupport.filter((s) => s.priority === 'Urgent' || s.priority === 'High' || s.status === 'New') : [];
  const down = sitesOn ? m.websites.filter((w) => w.status === 'Down') : [];
  const renew = sitesOn ? m.renewals.filter((r) => r.days <= 14) : [];
  const posts = m.postsDue;
  if (!support.length && !down.length && !renew.length && !posts.length) return null;
  return (
    <section className="td-section rm-today lr-business-today" data-section="business" aria-labelledby="td-h-business">
      <header className="td-section-head">
        <h2 id="td-h-business">
          Business
          <span className="td-count">{support.length + down.length + renew.length + posts.length}</span>
        </h2>
        <button type="button" className="td-section-link" onClick={() => openModule('business')}>
          <Icon name="chart" size={13} /> Business
        </button>
      </header>
      <ul className="rm-today-rows">
        {down.map((w) => (
          <li key={w.path} className="rm-today-row is-late">
            <button type="button" className="rm-today-main" onClick={() => open('website', w.path)}>
              <span className="rm-today-name">{w.name} is down</span>
              <span className="rm-today-sub">{w.url}</span>
            </button>
          </li>
        ))}
        {support.map((s) => (
          <li key={s.path} className={`rm-today-row${s.priority === 'Urgent' ? ' is-late' : ''}`}>
            <button type="button" className="rm-today-main" onClick={() => open('ticket', s.path)}>
              <span className="rm-today-name">{s.name}</span>
              <span className="rm-today-sub">{[s.priority !== 'Normal' && `${s.priority} support`, s.status === 'New' && 'new', s.customer].filter(Boolean).join(' · ')}</span>
            </button>
          </li>
        ))}
        {posts.map((p) => (
          <li key={`${p.campaign}:${p.row}`} className="rm-today-row is-change">
            <button type="button" className="rm-today-main" onClick={() => open('campaign', p.campaign)}>
              <span className="rm-today-name">Post: {p.title || 'a post'}</span>
              <span className="rm-today-sub">{[p.campaignName, p.channel, p.date === m.today ? 'today' : p.date && `was due ${dayText(p.date)}`].filter(Boolean).join(' · ')}</span>
            </button>
          </li>
        ))}
        {renew.map((r) => (
          <li key={`${r.site.path}:${r.what}`} className={`rm-today-row${r.days < 0 ? ' is-late' : ' is-change'}`}>
            <button type="button" className="rm-today-main" onClick={() => open('website', r.site.path)}>
              <span className="rm-today-name">
                {r.site.name}: {renewalWords(r, m.today).replace(/ \(.*\)$/, '').replace(/^./, (c) => c.toLowerCase())}
              </span>
              <span className="rm-today-sub">{[dayText(r.date), r.site.host || r.site.url].filter(Boolean).join(' · ')}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

