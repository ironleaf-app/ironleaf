// Business (Wave 7 part b, 24 Oct 2026; module 17 of the catalogue: "Releases, customers, marketing campaigns, support,
// site health · Release log, campaign board, customer list · Business"). A business of the person's own, kept in their
// Business area as plain notes:
//
//   Business/Releases/2.4.0.md          type: release — product, version, date, status, link; "## What changed" (a list)
//   Business/Customers/Harbour Cafe.md  type: customer — contact, email, plan, status, since, value, period, renews, source
//   Business/Campaigns/Spring launch.md type: campaign — channel, status, starts, ends, goal, budget, result;
//                                       "## Posts" | Date | Channel | What | Status | Link |
//   Business/Support/Login loop.md      type: support-item — customer "[[Harbour Cafe]]", received, status, priority,
//                                       product, version, channel; "## What they said", "## What we did"
//   Business/Websites/Main site.md      type: website — url, kind, status, checked, host, domain_renews, cert_expires;
//                                       "## Checks" | Date | Status | Response | Note |
//
// Work-confidential by default: an agent reads them only when the person allows that level. Nothing here names any
// business. Pure: no files, no Node, no DOM.

import { CAMPAIGN_CHANNELS, CAMPAIGN_STATUSES, CUSTOMER_PERIODS, CUSTOMER_STATUSES, POST_STATUSES, RELEASE_STATUSES, SUPPORT_CHANNELS, SUPPORT_PRIORITIES, SUPPORT_STATUSES, WEBSITE_KINDS, WEBSITE_STATUSES } from './life-records';
import { defaultRecordView, type RecordViewDef } from './record-views';
import type { WsRecord } from './workspace-records';
import type { WorkToolDef } from './work-module-tools';
import { dayWords, daysFrom, findByName, join, knownWord, linkName, moneyWords, plural, readAmount, readDay, readTable, refusedWords, sectionWords, str, todayOf, whenWords, type TableSpec } from './personal-records';
import { listOf } from './systems';

export const POSTS: TableSpec = {
  id: 'posts',
  name: 'Posts',
  heading: /^(posts?|content|schedule|pieces)$/i,
  fields: [
    { key: 'date', label: 'Date', col: /^(date|when|day)$/i, kind: 'date' },
    { key: 'channel', label: 'Channel', col: /^(channel|where|platform)$/i, kind: 'text' },
    { key: 'title', label: 'What', col: /^(what|post|title|words|piece)$/i, kind: 'text' },
    { key: 'status', label: 'Status', col: /^(status|state)$/i, kind: 'text' },
    { key: 'link', label: 'Link', col: /^(link|url)$/i, kind: 'text' },
  ],
  title: 'title',
  one: 'post',
};

export const CHECKS: TableSpec = {
  id: 'checks',
  name: 'Checks',
  heading: /^(checks?|health|health checks|uptime|monitoring)$/i,
  fields: [
    { key: 'date', label: 'Date', col: /^(date|when|day)$/i, kind: 'date' },
    { key: 'status', label: 'Status', col: /^(status|state|result)$/i, kind: 'text' },
    { key: 'response', label: 'Response', col: /^(response|time|speed|load)$/i, kind: 'text' },
    { key: 'note', label: 'Note', col: /^(notes?|what|details?)$/i, kind: 'text' },
  ],
  title: 'date',
  one: 'check',
};

export const CHANGES_HEADING = /^(what changed|changes|changelog|notes for this release|release notes)$/i;
export const SAID_HEADING = /^(what they said|their words|the problem|question)$/i;
export const DID_HEADING = /^(what we did|what i did|answer|fix|resolution)$/i;

export interface BizNote {
  path: string;
  title: string;
  props: Record<string, unknown>;
  content: string;
  type: string;
}

export interface Release {
  path: string;
  name: string;
  product: string;
  version: string;
  date: string | null;
  status: string;
  link: string;
  changes: string[];
}

export interface Customer {
  path: string;
  name: string;
  contact: string;
  email: string;
  plan: string;
  status: string;
  since: string | null;
  value: number | null;
  period: string;
  /** What they bring in a month (a yearly plan's twelfth; nothing for a one-off). */
  monthly: number;
  renews: string | null;
  renewsDays: number | null;
  source: string;
  /** Their support items still open. */
  openSupport: number;
}

export interface Post {
  row: number;
  date: string | null;
  channel: string;
  title: string;
  status: string;
  link: string;
  campaign: string;
  campaignName: string;
}

export interface Campaign {
  path: string;
  name: string;
  channel: string;
  status: string;
  starts: string | null;
  ends: string | null;
  goal: string;
  budget: number | null;
  result: string;
  posts: Post[];
}

export interface SupportItem {
  path: string;
  name: string;
  customer: string;
  customerPath: string | null;
  received: string | null;
  /** Days since it came in. */
  age: number | null;
  status: string;
  priority: string;
  product: string;
  version: string;
  channel: string;
  open: boolean;
  said: string;
  did: string;
}

export interface Check {
  row: number;
  date: string | null;
  status: string;
  response: string;
  note: string;
}

export interface Website {
  path: string;
  name: string;
  url: string;
  kind: string;
  status: string;
  checked: string | null;
  host: string;
  domainRenews: string | null;
  certExpires: string | null;
  /** The page's words last check, as a short fingerprint (empty until a scheduled or hand check reads the page). */
  pageHash: string;
  checks: Check[];
}

export interface Renewal {
  site: Website;
  what: 'domain' | 'certificate';
  date: string;
  days: number;
}

export interface BusinessModel {
  releases: Release[];
  customers: Customer[];
  campaigns: Campaign[];
  support: SupportItem[];
  websites: Website[];
  /** Support still open, most urgent first. */
  openSupport: SupportItem[];
  /** Domains and certificates running out within the module's days (and those passed). */
  renewals: Renewal[];
  /** Posts planned for today or already late, not posted. */
  postsDue: Post[];
  /** What active customers bring in a month. */
  monthly: number;
  currency: string;
  today: string;
  remindDays: number;
}

const OPEN_SUPPORT = /^(new|open|waiting)$/i;
const PRIORITY_ORDER = ['Urgent', 'High', 'Normal', 'Low'];

export function businessModel(notes: readonly BizNote[], today: Date | string = new Date(), opts: { remindDays?: number; currency?: string } = {}): BusinessModel {
  const t = todayOf(today);
  const remind = opts.remindDays ?? 30;
  const releases: Release[] = notes
    .filter((n) => n.type === 'release')
    .map((n) => ({ path: n.path, name: n.title, product: str(n.props.product), version: str(n.props.version) || n.title, date: readDay(n.props.date), status: knownWord(RELEASE_STATUSES, n.props.status) || 'Released', link: str(n.props.link), changes: listOf(n.content, CHANGES_HEADING).map((x) => x.text) }))
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || b.version.localeCompare(a.version, undefined, { numeric: true }));
  const customerNotes = notes.filter((n) => n.type === 'customer');
  const support: SupportItem[] = notes
    .filter((n) => n.type === 'support-item')
    .map((n) => {
      const customer = linkName(n.props.customer);
      const received = readDay(n.props.received);
      const status = knownWord(SUPPORT_STATUSES, n.props.status) || 'New';
      return { path: n.path, name: n.title, customer, customerPath: customer ? (customerNotes.find((c) => c.title.toLowerCase() === customer.toLowerCase())?.path ?? null) : null, received, age: received ? daysFrom(received, t) : null, status, priority: knownWord(SUPPORT_PRIORITIES, n.props.priority) || 'Normal', product: str(n.props.product), version: str(n.props.version), channel: knownWord(SUPPORT_CHANNELS, n.props.channel), open: OPEN_SUPPORT.test(status), said: sectionWords(n.content, SAID_HEADING), did: sectionWords(n.content, DID_HEADING) };
    });
  const customers: Customer[] = customerNotes
    .map((n) => {
      const value = readAmount(n.props.value);
      const period = knownWord(CUSTOMER_PERIODS, n.props.period) || 'Monthly';
      const status = knownWord(CUSTOMER_STATUSES, n.props.status) || 'Active';
      const renews = readDay(n.props.renews);
      return { path: n.path, name: n.title, contact: str(n.props.contact), email: str(n.props.email), plan: str(n.props.plan), status, since: readDay(n.props.since), value, period, monthly: value === null || status !== 'Active' ? 0 : period === 'Yearly' ? value / 12 : period === 'Once' ? 0 : value, renews, renewsDays: renews ? daysFrom(t, renews) : null, source: str(n.props.source), openSupport: support.filter((s) => s.open && s.customerPath === n.path).length };
    })
    .sort((a, b) => CUSTOMER_STATUSES.indexOf(a.status as never) - CUSTOMER_STATUSES.indexOf(b.status as never) || a.name.localeCompare(b.name));
  const campaigns: Campaign[] = notes
    .filter((n) => n.type === 'campaign')
    .map((n) => ({
      path: n.path,
      name: n.title,
      channel: knownWord(CAMPAIGN_CHANNELS, n.props.channel),
      status: knownWord(CAMPAIGN_STATUSES, n.props.status) || 'Idea',
      starts: readDay(n.props.starts),
      ends: readDay(n.props.ends),
      goal: str(n.props.goal),
      budget: readAmount(n.props.budget),
      result: str(n.props.result),
      posts: readTable(n.content, POSTS).rows.map(({ row, values: v }) => ({ row, date: readDay(v.date), channel: v.channel, title: v.title, status: knownWord(POST_STATUSES, v.status) || v.status, link: v.link, campaign: n.path, campaignName: n.title })),
    }))
    .sort((a, b) => CAMPAIGN_STATUSES.indexOf(a.status as never) - CAMPAIGN_STATUSES.indexOf(b.status as never) || (a.starts ?? '9999').localeCompare(b.starts ?? '9999'));
  const websites: Website[] = notes
    .filter((n) => n.type === 'website')
    .map((n) => {
      const checks = readTable(n.content, CHECKS).rows.map(({ row, values: v }) => ({ row, date: readDay(v.date), status: knownWord(WEBSITE_STATUSES, v.status) || v.status, response: v.response, note: v.note }));
      return { path: n.path, name: n.title, url: str(n.props.url), kind: knownWord(WEBSITE_KINDS, n.props.kind) || 'Website', status: knownWord(WEBSITE_STATUSES, n.props.status) || 'Unknown', checked: readDay(n.props.checked), host: str(n.props.host), domainRenews: readDay(n.props.domain_renews), certExpires: readDay(n.props.cert_expires), pageHash: str(n.props.page_hash), checks };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const renewals: Renewal[] = [];
  for (const w of websites) {
    if (w.domainRenews) renewals.push({ site: w, what: 'domain', date: w.domainRenews, days: daysFrom(t, w.domainRenews) });
    if (w.certExpires) renewals.push({ site: w, what: 'certificate', date: w.certExpires, days: daysFrom(t, w.certExpires) });
  }
  const openSupport = support.filter((s) => s.open).sort((a, b) => PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority) || (a.received ?? '').localeCompare(b.received ?? ''));
  return {
    releases,
    customers,
    campaigns,
    support: [...support].sort((a, b) => Number(b.open) - Number(a.open) || (b.received ?? '').localeCompare(a.received ?? '')),
    websites,
    openSupport,
    renewals: renewals.filter((r) => r.days <= remind).sort((a, b) => a.date.localeCompare(b.date)),
    postsDue: campaigns.filter((c) => !/^(done|dropped)$/i.test(c.status)).flatMap((c) => c.posts.filter((p) => p.date && p.date <= t && !/^posted$/i.test(p.status))),
    monthly: customers.reduce((a, c) => a + c.monthly, 0),
    currency: opts.currency ?? 'AUD',
    today: t,
    remindDays: remind,
  };
}

export const renewalWords = (r: Renewal, today: string) => `${r.what === 'domain' ? 'Domain' : 'Certificate'} ${r.days < 0 ? `ran out ${whenWords(r.days)}` : r.what === 'domain' ? `renews ${whenWords(r.days)} (${dayWords(r.date, today)})` : `expires ${whenWords(r.days)} (${dayWords(r.date, today)})`}`;

// ── New notes ────────────────────────────────────────────────────────────────────────────────────────────────────────

const yq = (s: string) => JSON.stringify(s);
const p = (k: string, v: string | number | null | undefined) => (v === null || v === undefined || v === '' ? `${k}:` : typeof v === 'number' ? `${k}: ${v}` : /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${k}: ${v}` : `${k}: ${yq(v)}`);

export function newReleaseText(i: { product?: string; version?: string; date?: string | null; status?: string; link?: string; changes?: string[] }): string {
  const changes = (i.changes ?? []).map((c) => str(c)).filter(Boolean);
  return `---\ntype: release\n${p('product', str(i.product))}\n${p('version', str(i.version))}\n${p('date', i.date ?? '')}\nstatus: ${knownWord(RELEASE_STATUSES, i.status) || 'Released'}\n${p('link', str(i.link))}\n---\n## What changed\n\n${changes.length ? changes.map((c) => `- ${c}`).join('\n') : '- '}\n\n## Notes\n\n`;
}
export function newCustomerText(i: { contact?: string; email?: string; plan?: string; status?: string; since?: string | null; value?: number | null; period?: string; renews?: string | null; source?: string }): string {
  return `---\ntype: customer\n${p('contact', str(i.contact))}\n${p('email', str(i.email))}\n${p('plan', str(i.plan))}\nstatus: ${knownWord(CUSTOMER_STATUSES, i.status) || 'Active'}\n${p('since', i.since ?? '')}\n${p('value', i.value ?? null)}\nperiod: ${knownWord(CUSTOMER_PERIODS, i.period) || 'Monthly'}\n${p('renews', i.renews ?? '')}\n${p('source', str(i.source))}\n---\n## Notes\n\n`;
}
export function newCampaignText(i: { channel?: string; status?: string; starts?: string | null; ends?: string | null; goal?: string; budget?: number | null }): string {
  return `---\ntype: campaign\nchannel: ${knownWord(CAMPAIGN_CHANNELS, i.channel) || 'Other'}\nstatus: ${knownWord(CAMPAIGN_STATUSES, i.status) || 'Idea'}\n${p('starts', i.starts ?? '')}\n${p('ends', i.ends ?? '')}\n${p('goal', str(i.goal))}\n${p('budget', i.budget ?? null)}\nresult:\n---\n## Posts\n\n| Date | Channel | What | Status | Link |\n| --- | --- | --- | --- | --- |\n\n## Notes\n\n`;
}
export function newSupportText(i: { customer?: string; received?: string; status?: string; priority?: string; product?: string; version?: string; channel?: string; said?: string }): string {
  return `---\ntype: support-item\ncustomer:${linkName(i.customer) ? ` ${yq(`[[${linkName(i.customer)}]]`)}` : ''}\n${p('received', i.received ?? '')}\nstatus: ${knownWord(SUPPORT_STATUSES, i.status) || 'New'}\npriority: ${knownWord(SUPPORT_PRIORITIES, i.priority) || 'Normal'}\n${p('product', str(i.product))}\n${p('version', str(i.version))}\nchannel: ${knownWord(SUPPORT_CHANNELS, i.channel) || 'Email'}\n---\n## What they said\n\n${i.said ? `${i.said.trim()}\n` : ''}\n## What we did\n\n`;
}
export function newWebsiteText(i: { url?: string; kind?: string; host?: string; domain_renews?: string | null; cert_expires?: string | null }): string {
  return `---\ntype: website\n${p('url', str(i.url))}\nkind: ${knownWord(WEBSITE_KINDS, i.kind) || 'Website'}\nstatus: Unknown\nchecked:\n${p('host', str(i.host))}\n${p('domain_renews', i.domain_renews ?? '')}\n${p('cert_expires', i.cert_expires ?? '')}\npage_hash:\n---\n## Checks\n\n| Date | Status | Response | Note |\n| --- | --- | --- | --- |\n\n## Notes\n\n`;
}

/** A page's words as a short fingerprint (8.3 wave 1, 30 Oct 2026): markup, scripts and spacing are not words, so a
 *  restyle does not read as a change and a wording change does. Pure: the visit itself is the caller's. */
export function pageHashFor(body: string): string {
  const words = String(body ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  let h = 0x811c9dc5;
  for (let i = 0; i < words.length; i++) {
    h ^= words.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return words ? h.toString(16).padStart(8, '0') : '';
}

/** Whether a website is due its scheduled check: never checked, or last checked before today. */
export const websiteCheckDue = (w: Pick<Website, 'checked'>, today: string) => !w.checked || w.checked < today;

/** This week in Business (8.3 wave 1): shipped, owed a reply, due to post, and how the websites are. */
export interface BusinessWeek {
  releases: Release[];
  openSupport: SupportItem[];
  oldestOpen: SupportItem | null;
  postsDue: Post[];
  activeCustomers: number;
  monthly: number;
  sitesUp: number;
  sitesDown: Website[];
  renewals: Renewal[];
}

export function businessWeek(m: BusinessModel): BusinessWeek {
  const monday = businessWeekStart(m.today);
  return {
    releases: m.releases.filter((r) => r.date && r.date >= monday && r.date <= m.today),
    openSupport: m.openSupport,
    oldestOpen: [...m.openSupport].sort((a, b) => (a.received ?? '').localeCompare(b.received ?? ''))[0] ?? null,
    postsDue: m.postsDue,
    activeCustomers: m.customers.filter((c) => c.status === 'Active').length,
    monthly: m.monthly,
    sitesUp: m.websites.filter((w) => w.status === 'Up' || w.status === 'Slow').length,
    sitesDown: m.websites.filter((w) => w.status === 'Down'),
    renewals: m.renewals,
  };
}

export function businessWeekWords(m: BusinessModel): string {
  const w = businessWeek(m);
  const money = (n: number) => moneyWords(Math.round(n * 100) / 100, m.currency);
  return join([
    `This week in Business (from ${dayWords(businessWeekStart(m.today), m.today)}):`,
    w.releases.length ? `Shipped: ${w.releases.map((r) => `${r.product ? `${r.product} ` : ''}${r.version}`).join(', ')}.` : 'Nothing shipped this week yet.',
    w.openSupport.length ? `${plural(w.openSupport.length, 'support item')} still open${w.oldestOpen ? `; oldest is ${w.oldestOpen.name}${w.oldestOpen.customer ? ` from ${w.oldestOpen.customer}` : ''}${w.oldestOpen.received ? `, came in ${dayWords(w.oldestOpen.received, m.today)}` : ''}` : ''}.` : 'No support waiting for a reply.',
    w.postsDue.length ? `Posts due and not out yet: ${w.postsDue.map((p) => p.title || 'a post').join('; ')}.` : 'No posts due.',
    `${plural(w.activeCustomers, 'active customer')}; about ${money(w.monthly)} a month.`,
    m.websites.length ? `Websites: ${w.sitesUp} of ${m.websites.length} up${w.sitesDown.length ? `; down: ${w.sitesDown.map((s) => s.name).join(', ')}` : ''}.` : 'No websites yet.',
    w.renewals.length ? `Renewals coming: ${w.renewals.map((r) => `${r.site.name} ${renewalWords(r, m.today).toLowerCase()}`).join('; ')}.` : '',
  ]);
}

const businessWeekStart = (today: string) => {
  const d = new Date(`${today}T12:00:00`);
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
  return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
};

// ── Records for the views ────────────────────────────────────────────────────────────────────────────────────────────

export function businessRecords(m: BusinessModel): WsRecord[] {
  const out: WsRecord[] = [];
  for (const r of m.releases) out.push({ id: `${r.path}::release`, kind: 'release', title: r.version || r.name, path: r.path, fields: { product: r.product || null, date: r.date, status: r.status, changes: r.changes.length, month: r.date?.slice(0, 7) ?? null }, links: [], ref: { at: 'note', path: r.path } });
  for (const c of m.customers) out.push({ id: `${c.path}::customer`, kind: 'customer', title: c.name, path: c.path, fields: { status: c.status, plan: c.plan || null, pays: c.value, period: c.period, monthly: c.monthly || null, since: c.since, renews: c.renews, contact: c.contact || null, email: c.email || null, source: c.source || null, open_support: c.openSupport || null }, links: [], ref: { at: 'note', path: c.path } });
  for (const c of m.campaigns) out.push({ id: `${c.path}::campaign`, kind: 'campaign', title: c.name, path: c.path, fields: { channel: c.channel || null, status: c.status, starts: c.starts, ends: c.ends, goal: c.goal || null, budget: c.budget, posts: c.posts.length, result: c.result || null }, links: [], ref: { at: 'note', path: c.path } });
  for (const s of m.support) out.push({ id: `${s.path}::ticket`, kind: 'ticket', title: s.name, path: s.path, fields: { customer: s.customer || null, received: s.received, status: s.status, priority: s.priority, product: s.product || null, version: s.version || null, channel: s.channel || null, age: s.age }, links: s.customerPath ? [`${s.customerPath}::customer`] : [], ref: { at: 'note', path: s.path } });
  for (const w of m.websites) out.push({ id: `${w.path}::website`, kind: 'website', title: w.name, path: w.path, fields: { url: w.url || null, site_kind: w.kind, status: w.status, checked: w.checked, domain_renews: w.domainRenews, cert_expires: w.certExpires }, links: [], ref: { at: 'note', path: w.path } });
  return out;
}

export const BUSINESS_EDITABLE: Record<string, string[]> = {
  release: ['product', 'date', 'status'],
  customer: ['status', 'plan', 'pays', 'period', 'since', 'renews', 'contact', 'email', 'source'],
  campaign: ['channel', 'status', 'starts', 'ends', 'goal', 'budget', 'result'],
  ticket: ['customer', 'received', 'status', 'priority', 'product', 'version', 'channel'],
  website: ['url', 'site_kind', 'status', 'checked', 'domain_renews', 'cert_expires'],
};

export function businessSectionViews(section: string): RecordViewDef[] {
  const v = (kinds: WsRecord['kind'][], layout: RecordViewDef['layout'], title: string, patch: Partial<RecordViewDef> = {}): RecordViewDef => ({ ...defaultRecordView(kinds, layout, title), scope: 'vault', showDone: true, ...patch });
  switch (section) {
    case 'releases':
      return [v(['release'], 'chart', 'Releases each month', { chart: { type: 'bar', by: 'month', measure: 'count' } })];
    case 'customers':
      return [
        v(['customer'], 'table', 'Every customer', { fields: ['status', 'plan', 'pays', 'period', 'since', 'renews', 'open_support'], sort: { field: 'title', dir: 'asc' } }),
        v(['customer'], 'chart', 'Customers by status', { chart: { type: 'donut', by: 'status', measure: 'count' } }),
      ];
    case 'campaigns':
      return [v(['campaign'], 'board', 'Campaign board', { groupBy: 'status', groupOrder: [...CAMPAIGN_STATUSES], fields: ['channel', 'starts', 'posts'] })];
    case 'support':
      return [v(['ticket'], 'table', 'Every support item', { fields: ['customer', 'priority', 'status', 'received', 'product', 'channel'], groupBy: 'status', sort: { field: 'received', dir: 'desc' } })];
  }
  return [];
}

// ── The agent tools ──────────────────────────────────────────────────────────────────────────────────────────────────

export const BUSINESS_TOOLS: WorkToolDef[] = [
  {
    name: 'business_release_log',
    module: 'business',
    write: false,
    title: 'Release log',
    step: 'Looked through the release log',
    description: 'The release log of the person’s own business (Ironleaf › Business): each release with its product, version, day, status and what changed, newest first. Use it for "what went out last?", "when did 2.3 ship?".',
    parameters: { type: 'object', properties: { product: { type: 'string' }, limit: { type: 'number', description: 'How many, newest first (20 unless said).' } }, additionalProperties: false },
  },
  {
    name: 'business_release_add',
    module: 'business',
    write: true,
    title: 'Log a release',
    step: 'Logged a release',
    description: 'Add a release to the log with what the person said: product, version, day (today unless said), status and what changed. Never invent changes.',
    parameters: { type: 'object', properties: { product: { type: 'string' }, version: { type: 'string' }, date: { type: 'string', description: 'YYYY-MM-DD' }, status: { type: 'string', enum: [...RELEASE_STATUSES] }, changes: { type: 'array', items: { type: 'string' } } }, required: ['version'], additionalProperties: false },
  },
  {
    name: 'business_customer_list',
    module: 'business',
    write: false,
    title: 'Customers',
    step: 'Looked through the customers',
    description: 'The business’s customers with their status, plan, what they pay, since when, when it renews and open support items, and what active customers bring in a month.',
    parameters: { type: 'object', properties: { status: { type: 'string', enum: [...CUSTOMER_STATUSES] }, query: { type: 'string' } }, additionalProperties: false },
  },
  {
    name: 'business_campaign_board',
    module: 'business',
    write: false,
    title: 'Campaign board',
    step: 'Looked at the campaign board',
    description: 'Marketing campaigns by status (Idea, Planned, Live, Done, Dropped) with their channel, dates, goal and posts, and posts due that haven’t gone out.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'business_support_open',
    module: 'business',
    write: false,
    title: 'Open support',
    step: 'Checked open support',
    description: 'Support items still open (New, Open, Waiting), most urgent first, with the customer, how long ago they came in, product and version.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'business_support_add',
    module: 'business',
    write: true,
    title: 'Add a support item',
    step: 'Added a support item',
    description: 'Add a customer’s question or problem as a support item: a short title, the customer (one already in Business when given), priority, channel, product and version, and their words. Only what the person gave.',
    parameters: { type: 'object', properties: { title: { type: 'string' }, customer: { type: 'string' }, priority: { type: 'string', enum: [...SUPPORT_PRIORITIES] }, channel: { type: 'string', enum: [...SUPPORT_CHANNELS] }, product: { type: 'string' }, version: { type: 'string' }, said: { type: 'string' } }, required: ['title'], additionalProperties: false },
  },
  {
    name: 'business_customer_add',
    module: 'business',
    write: true,
    title: 'Add a customer',
    step: 'Added a customer to Business',
    description: 'Add a customer to Business with what the person gave: its name, contact, email, plan, status, since when, what they pay and how often, when it renews and where they came from. Never invent an amount.',
    parameters: { type: 'object', properties: { name: { type: 'string' }, contact: { type: 'string' }, email: { type: 'string' }, plan: { type: 'string' }, status: { type: 'string', enum: [...CUSTOMER_STATUSES] }, since: { type: 'string', description: 'YYYY-MM-DD' }, value: { type: 'number', description: 'What they pay each period.' }, period: { type: 'string', enum: [...CUSTOMER_PERIODS] }, renews: { type: 'string', description: 'YYYY-MM-DD' }, source: { type: 'string' } }, required: ['name'], additionalProperties: false },
  },
  {
    name: 'business_campaign_add',
    module: 'business',
    write: true,
    title: 'Add a campaign',
    step: 'Added a campaign to Business',
    description: 'Add a marketing campaign to Business with what the person gave: its name, channel, status, start and end days, goal and budget.',
    parameters: { type: 'object', properties: { name: { type: 'string' }, channel: { type: 'string', enum: [...CAMPAIGN_CHANNELS] }, status: { type: 'string', enum: [...CAMPAIGN_STATUSES] }, starts: { type: 'string', description: 'YYYY-MM-DD' }, ends: { type: 'string', description: 'YYYY-MM-DD' }, goal: { type: 'string' }, budget: { type: 'number' } }, required: ['name'], additionalProperties: false },
  },
  {
    name: 'business_support_close',
    module: 'business',
    write: true,
    title: 'Close a support item',
    step: 'Closed a support item in Business',
    description: 'Close a support item in Business (by its title, or its customer): its status becomes Closed, with what was done when the person says it. Only when the person says it is answered.',
    parameters: { type: 'object', properties: { item: { type: 'string', description: 'The support item’s title, or its customer.' }, did: { type: 'string', description: 'What was done (optional).' } }, required: ['item'], additionalProperties: false },
  },
  {
    name: 'business_site_check',
    module: 'business',
    write: true,
    title: 'Check a website now',
    step: 'Checked a website in Business',
    description: 'Check one of the business’s websites now (a real visit to its address, read-only): whether it answers, how fast, and its status written into its checks with today’s day. The site by name or address; every site when left out.',
    parameters: { type: 'object', properties: { site: { type: 'string', description: 'The website’s name or address (optional).' } }, additionalProperties: false },
  },
  {
    name: 'business_site_health',
    module: 'business',
    write: false,
    title: 'Website health',
    step: 'Checked the websites’ health',
    description: 'Each website, shop or service of the business with its status, last check and when its domain and certificate run out.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'business_week',
    module: 'business',
    write: false,
    title: 'How the business is doing this week',
    step: 'Summed up the business this week',
    description: 'One short answer to "how is the business doing this week": what shipped, support still open (oldest first), posts due, active customers and what they bring in, and whether the websites are up.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
];

const OFF = 'The Business module is off in Ironleaf (Settings › Packs). Say so; don’t guess at the business’s releases, customers or support.';

export interface BusinessToolInput {
  model: BusinessModel;
  on: boolean;
  refused?: number;
  agent?: string;
}

export function answerBusinessTool(input: BusinessToolInput, name: string, args: Record<string, unknown> = {}): string | null {
  const tool = BUSINESS_TOOLS.find((t) => t.name === name);
  if (!tool || tool.write) return null;
  if (!input.on) return OFF;
  const m = input.model;
  const refused = refusedWords(input.refused, 'business note', input.agent);
  const money = (n: number | null) => (n === null ? '' : moneyWords(n, m.currency));
  if (name === 'business_release_log') {
    const product = str(args.product).toLowerCase();
    const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.min(200, Math.round(args.limit)) : 20;
    const list = m.releases.filter((r) => !product || r.product.toLowerCase().includes(product));
    if (!list.length) return join([m.releases.length ? 'No release matches that.' : 'No releases logged in Business yet.', refused]);
    return join([`${plural(list.length, 'release')}${list.length > limit ? `, the newest ${limit}` : ''}:`, ...list.slice(0, limit).map((r) => `- ${r.product ? `${r.product} ` : ''}${r.version}: ${r.status}${r.date ? `, ${dayWords(r.date, m.today)}` : ''}${r.changes.length ? `; ${r.changes.slice(0, 6).join('; ')}` : ''} [${r.path}]`), refused]);
  }
  if (name === 'business_customer_list') {
    const status = str(args.status).toLowerCase();
    const q = str(args.query).toLowerCase();
    const list = m.customers.filter((c) => (!status || c.status.toLowerCase() === status) && (!q || `${c.name} ${c.contact} ${c.plan} ${c.email}`.toLowerCase().includes(q)));
    if (!list.length) return join([m.customers.length ? 'No customer matches that.' : 'No customers in Business yet.', refused]);
    return join([`${plural(list.length, 'customer')}; active customers bring in about ${money(Math.round(m.monthly * 100) / 100)} a month:`, ...list.map((c) => `- ${c.name}: ${c.status}${c.plan ? `, ${c.plan}` : ''}${c.value !== null ? `, ${money(c.value)} ${c.period.toLowerCase()}` : ''}${c.since ? `, since ${dayWords(c.since, m.today)}` : ''}${c.renews ? `, renews ${dayWords(c.renews, m.today)}` : ''}${c.openSupport ? `; ${plural(c.openSupport, 'open support item')}` : ''} [${c.path}]`), refused]);
  }
  if (name === 'business_campaign_board') {
    if (!m.campaigns.length) return join(['No campaigns in Business yet.', refused]);
    const lines: string[] = [];
    for (const st of CAMPAIGN_STATUSES) {
      const of = m.campaigns.filter((c) => c.status === st);
      if (!of.length) continue;
      lines.push(`${st}:`);
      for (const c of of) lines.push(`- ${c.name}${c.channel ? ` (${c.channel})` : ''}${c.starts ? `, ${dayWords(c.starts, m.today)}${c.ends ? ` to ${dayWords(c.ends, m.today)}` : ''}` : ''}${c.goal ? `; goal: ${c.goal}` : ''}; ${plural(c.posts.length, 'post')} (${c.posts.filter((x) => /^posted$/i.test(x.status)).length} posted) [${c.path}]`);
    }
    return join([...lines, m.postsDue.length ? `Posts due and not out yet: ${m.postsDue.map((x) => `${x.title || 'a post'} (${x.campaignName}, ${x.date ? dayWords(x.date, m.today) : ''})`).join('; ')}.` : '', refused]);
  }
  if (name === 'business_support_open') {
    if (!m.openSupport.length) return join([m.support.length ? 'No support items are open.' : 'No support items in Business yet.', refused]);
    return join([`${plural(m.openSupport.length, 'open support item')}:`, ...m.openSupport.map((s) => `- ${s.name}: ${s.priority}, ${s.status}${s.customer ? `, from ${s.customer}` : ''}${s.received ? `, came in ${whenWords(-(s.age ?? 0))}` : ''}${s.product ? `; ${s.product}${s.version ? ` ${s.version}` : ''}` : ''}${s.said ? ` — “${s.said.split('\n')[0].slice(0, 160)}”` : ''} [${s.path}]`), refused]);
  }
  if (name === 'business_week') return join([businessWeekWords(m), refused]);
  if (name === 'business_site_health') {
    if (!m.websites.length) return join(['No websites in Business yet.', refused]);
    return join([
      `${plural(m.websites.length, 'site')}:`,
      ...m.websites.map((w) => {
        const last = [...w.checks].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))[0];
        return `- ${w.name}${w.url ? ` (${w.url})` : ''}: ${w.status}${w.checked ? `, checked ${dayWords(w.checked, m.today)}` : ''}${last?.note ? ` — ${last.note}` : ''}${w.domainRenews ? `; domain renews ${dayWords(w.domainRenews, m.today)}` : ''}${w.certExpires ? `; certificate expires ${dayWords(w.certExpires, m.today)}` : ''} [${w.path}]`;
      }),
      m.renewals.length ? `Coming up: ${m.renewals.map((r) => `${r.site.name} ${renewalWords(r, m.today).toLowerCase()}`).join('; ')}.` : '',
      refused,
    ]);
  }
  return null;
}

export const findCustomer = (m: BusinessModel, words: unknown) => findByName(m.customers, words, (c) => [c.name, c.email]);

/** What a real website check found, in the module's own words: no answer (or an error answer) is Down, an answer
 *  slower than five seconds is Slow, anything else that answers is Up. Pure: the visit itself is the caller's. */
export function websiteStatusFor(statusCode: number | null, ms: number | null): { status: string; response: string } {
  if (statusCode === null) return { status: 'Down', response: '' };
  if (statusCode >= 500) return { status: 'Down', response: `${statusCode} in ${ms ?? 0} ms` };
  if (ms !== null && ms > 5000) return { status: 'Slow', response: `${statusCode} in ${ms} ms` };
  return { status: 'Up', response: ms !== null ? `${statusCode} in ${ms} ms` : `${statusCode}` };
}

export { CAMPAIGN_STATUSES, POST_STATUSES, SUPPORT_STATUSES };
