// Business on the main side (Wave 7 part b; src/shared/business.ts). Releases, customers, campaigns, support items and
// websites are notes in the Business area: a value changed is one property, a post or a check one row of its table, a
// change in a release one line of its list, a support item's words their section. The bell is told of an urgent support
// item, a site that is down and a domain or certificate running out, each once.

import { connect as tlsConnect } from 'node:tls';
import { CHECKS, CHANGES_HEADING, DID_HEADING, POSTS, SAID_HEADING, answerBusinessTool, businessModel, businessWeekWords, findCustomer, newCampaignText, newCustomerText, newReleaseText, newSupportText, newWebsiteText, pageHashFor, renewalWords, websiteCheckDue, websiteStatusFor, type BusinessModel } from '../../shared/business';
import { withSectionText } from '../../shared/goals';
import { partOn } from '../../shared/life-modules';
import { CAMPAIGN_CHANNELS, CAMPAIGN_STATUSES, CUSTOMER_PERIODS, CUSTOMER_STATUSES, POST_STATUSES, RELEASE_STATUSES, SUPPORT_CHANNELS, SUPPORT_PRIORITIES, SUPPORT_STATUSES, WEBSITE_KINDS, WEBSITE_STATUSES } from '../../shared/life-records';
import { currencyOf } from '../../shared/module-records';
import { cleanCell, dayWords, knownWord, readAmount, readDay, str, tableWithRow, type PropSpec } from '../../shared/personal-records';
import { withList } from '../../shared/systems';
import { setNoteProp } from '../../shared/views';
import type { VaultIndex } from '../indexer';
import type { WorkModules, WorkNotice, WorkPart } from '../work-modules';
import { itemWords, namedIn, remindDaysOption, type PersonalPart } from '../personal/common';
import { agentChange, agentNote, dayOf, kindOfNote, notesOf, O, refusedCount, removeRow, S, setCells, setProp, titleOf } from './common';

export type BusinessView = BusinessModel & { folder: string };

const TYPES = ['release', 'customer', 'campaign', 'support-item', 'website'];
const KIND_TYPE: Record<string, string> = { release: 'release', customer: 'customer', campaign: 'campaign', ticket: 'support-item', website: 'website' };

const PROPS: Record<string, Record<string, PropSpec>> = {
  release: {
    product: { field: 'product', key: 'product', kind: 'text', label: 'Product' },
    version: { field: 'version', key: 'version', kind: 'text', label: 'Version' },
    date: { field: 'date', key: 'date', kind: 'date', label: 'Day' },
    status: { field: 'status', key: 'status', kind: 'choice', label: 'Status', options: RELEASE_STATUSES },
    link: { field: 'link', key: 'link', kind: 'url', label: 'Link' },
  },
  customer: {
    status: { field: 'status', key: 'status', kind: 'choice', label: 'Status', options: CUSTOMER_STATUSES },
    plan: { field: 'plan', key: 'plan', kind: 'text', label: 'Plan' },
    pays: { field: 'pays', key: 'value', kind: 'money', label: 'What they pay' },
    period: { field: 'period', key: 'period', kind: 'choice', label: 'How often', options: CUSTOMER_PERIODS },
    since: { field: 'since', key: 'since', kind: 'date', label: 'Customer since' },
    renews: { field: 'renews', key: 'renews', kind: 'date', label: 'Renews' },
    contact: { field: 'contact', key: 'contact', kind: 'text', label: 'Contact' },
    email: { field: 'email', key: 'email', kind: 'email', label: 'Email' },
    source: { field: 'source', key: 'source', kind: 'text', label: 'Came from' },
  },
  campaign: {
    channel: { field: 'channel', key: 'channel', kind: 'choice', label: 'Channel', options: CAMPAIGN_CHANNELS },
    status: { field: 'status', key: 'status', kind: 'choice', label: 'Status', options: CAMPAIGN_STATUSES },
    starts: { field: 'starts', key: 'starts', kind: 'date', label: 'Starts' },
    ends: { field: 'ends', key: 'ends', kind: 'date', label: 'Ends' },
    goal: { field: 'goal', key: 'goal', kind: 'text', label: 'Goal' },
    budget: { field: 'budget', key: 'budget', kind: 'money', label: 'Budget' },
    result: { field: 'result', key: 'result', kind: 'text', label: 'Result' },
  },
  ticket: {
    customer: { field: 'customer', key: 'customer', kind: 'link', label: 'Customer' },
    received: { field: 'received', key: 'received', kind: 'date', label: 'Came in' },
    status: { field: 'status', key: 'status', kind: 'choice', label: 'Status', options: SUPPORT_STATUSES },
    priority: { field: 'priority', key: 'priority', kind: 'choice', label: 'Priority', options: SUPPORT_PRIORITIES },
    product: { field: 'product', key: 'product', kind: 'text', label: 'Product' },
    version: { field: 'version', key: 'version', kind: 'text', label: 'Version' },
    channel: { field: 'channel', key: 'channel', kind: 'choice', label: 'Channel', options: SUPPORT_CHANNELS },
  },
  website: {
    url: { field: 'url', key: 'url', kind: 'url', label: 'Address' },
    site_kind: { field: 'site_kind', key: 'kind', kind: 'choice', label: 'Kind', options: WEBSITE_KINDS },
    status: { field: 'status', key: 'status', kind: 'choice', label: 'Status', options: WEBSITE_STATUSES },
    checked: { field: 'checked', key: 'checked', kind: 'date', label: 'Last checked' },
    host: { field: 'host', key: 'host', kind: 'text', label: 'Hosted with' },
    domain_renews: { field: 'domain_renews', key: 'domain_renews', kind: 'date', label: 'Domain renews' },
    cert_expires: { field: 'cert_expires', key: 'cert_expires', kind: 'date', label: 'Certificate expires' },
  },
};

export function makeBusiness(w: WorkModules): PersonalPart {
  const model = async (index: VaultIndex = w.d.index): Promise<BusinessModel> => businessModel(await notesOf(w, index, TYPES), w.today(), { remindDays: await w.remindDays('business'), currency: currencyOf(await w.options()) });

  const money = (v: unknown, label: string) => {
    const s = S(v, 30);
    if (!s) return null;
    const n = readAmount(s);
    if (n === null) throw new Error(`Give ${label} as an amount, like 49.95.`);
    return n;
  };

  const add = async (type: string, input: unknown): Promise<string> => {
    const o = O(input);
    const name = S(o.name, 100) || (type === 'release' ? S(o.version, 60) : '');
    if (!name) throw new Error('It needs a name.');
    const m = await model();
    const list = type === 'release' ? m.releases : type === 'customer' ? m.customers : type === 'campaign' ? m.campaigns : type === 'support-item' ? m.support : m.websites;
    if (list.some((x) => x.name.toLowerCase() === name.toLowerCase())) throw new Error(`There’s already one called ${name}.`);
    let text = '';
    if (type === 'release') text = newReleaseText({ product: S(o.product, 80), version: S(o.version, 60) || name, date: dayOf(o.date, 'the day', '2026-11-03') ?? w.todayIso(), status: S(o.status, 20), link: S(o.link, 300), changes: Array.isArray(o.changes) ? o.changes.map((x) => S(x, 300)) : S(o.changes, 4000).split(/\s*[;\n]\s*/) });
    else if (type === 'customer') text = newCustomerText({ contact: S(o.contact, 100), email: S(o.email, 120), plan: S(o.plan, 80), status: S(o.status, 20), since: dayOf(o.since, 'the day they started', '2026-11-03') ?? w.todayIso(), value: money(o.value, 'what they pay'), period: S(o.period, 20), renews: dayOf(o.renews, 'the renewal day', '2026-11-03'), source: S(o.source, 100) });
    else if (type === 'campaign') text = newCampaignText({ channel: S(o.channel, 40), status: S(o.status, 20), starts: dayOf(o.starts, 'the start day', '2026-11-03'), ends: dayOf(o.ends, 'the end day', '2026-11-03'), goal: S(o.goal, 200), budget: money(o.budget, 'the budget') });
    else if (type === 'support-item') text = newSupportText({ customer: S(o.customer, 100), received: dayOf(o.received, 'the day it came in', '2026-11-03') ?? w.todayIso(), status: S(o.status, 20), priority: S(o.priority, 20), product: S(o.product, 80), version: S(o.version, 40), channel: S(o.channel, 20), said: S(o.said, 4000) });
    else text = newWebsiteText({ url: S(o.url, 300), kind: S(o.kind, 20), host: S(o.host, 100), domain_renews: dayOf(o.domain_renews, 'the domain’s renewal day', '2026-11-03'), cert_expires: dayOf(o.cert_expires, 'the certificate’s expiry', '2026-11-03') });
    return w.newNote(await w.folderOf(type), name, text);
  };

  const setField = async (input: unknown): Promise<string | null> => {
    const o = O(input);
    const rel = S(o.path, 1000);
    const kind = S(o.kind, 20) || kindOfNote(w, rel, KIND_TYPE, 'That isn’t one of Business’s records.');
    const p = PROPS[kind]?.[S(o.field, 40)];
    if (!p) throw new Error('That can’t be changed here.');
    await setProp(w, rel, p, o.value === null ? '' : o.value);
    if (kind === 'ticket' && p.key === 'status' && /^(solved|closed)$/i.test(S(o.value))) return `${titleOf(rel)}: ${S(o.value).toLowerCase()}.`;
    return null;
  };

  const cleanPost = (v: Record<string, unknown>): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const f of POSTS.fields) if (v[f.key] !== undefined && v[f.key] !== null) out[f.key] = f.key === 'status' ? knownWord(POST_STATUSES, v[f.key]) : f.key === 'channel' ? knownWord(CAMPAIGN_CHANNELS, v[f.key]) : cleanCell(f, v[f.key]);
    return out;
  };

  /** The day a website's safety certificate runs out, read from the site itself (8.3 wave 1, 30 Oct 2026). Only the
   *  dates are read; an unreadable or plain-http site gives nothing and keeps the day already written. */
  const certExpiryOf = (url: string): Promise<string | null> =>
    new Promise((resolve) => {
      let u: URL;
      try {
        u = new URL(url);
      } catch {
        resolve(null);
        return;
      }
      if (u.protocol !== 'https:') {
        resolve(null);
        return;
      }
      const isIp = /^\d+\.\d+\.\d+\.\d+$/.test(u.hostname) || u.hostname.includes(':');
      let sock: ReturnType<typeof tlsConnect>;
      try {
        sock = tlsConnect({ host: u.hostname, port: u.port ? Number(u.port) : 443, ...(isIp ? {} : { servername: u.hostname }), rejectUnauthorized: false, timeout: 5_000 }, () => {
        const cert = sock.getPeerCertificate();
        sock.end();
        const d = cert?.valid_to ? new Date(cert.valid_to) : null;
        resolve(d && !Number.isNaN(d.getTime()) ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : null);
      });
        sock.on('error', () => resolve(null));
        sock.on('timeout', () => {
          sock.destroy();
          resolve(null);
        });
      } catch {
        resolve(null);
      }
    });

  /** A real check of one website (8.2 honesty, 29 Oct 2026; scheduled, with certificate and page words, 8.3 wave 1):
   *  visit its address once, read-only, and write what was found into its Checks. Never follows into a login. */
  const checkWebsite = async (site: BusinessModel['websites'][number], how = 'Checked now'): Promise<string> => {
    const url = /^https?:\/\//i.test(site.url) ? site.url : `https://${site.url}`;
    const started = Date.now();
    let found: { status: string; response: string };
    let hash = '';
    try {
      const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(10_000), headers: { 'user-agent': 'Ironleaf website check' } });
      found = websiteStatusFor(res.status, Date.now() - started);
      hash = pageHashFor((await res.text().catch(() => '')).slice(0, 2_000_000));
    } catch {
      found = websiteStatusFor(null, null);
    }
    const changed = !!hash && !!site.pageHash && hash !== site.pageHash;
    const cert = found.status === 'Down' ? null : await certExpiryOf(url).catch(() => null);
    const date = w.todayIso();
    await w.change(site.path, (text) => {
      let t = tableWithRow(text, CHECKS, { date, status: found.status, response: found.response, note: changed ? 'Page words changed since the last check' : how });
      t = setNoteProp(t, 'status', found.status);
      t = setNoteProp(t, 'checked', date);
      if (hash) t = setNoteProp(t, 'page_hash', hash);
      if (cert) t = setNoteProp(t, 'cert_expires', cert);
      return t;
    });
    return `${site.name}: ${found.status.toLowerCase()}${found.response ? ` (${found.response})` : ''}${changed ? '; its page words have changed' : ''}${cert ? `; certificate expires ${cert}` : ''}.`;
  };

  const ops: WorkPart['ops'] = {
    model: async (): Promise<BusinessView> => ({ ...(await model()), folder: await w.moduleFolder('business') }),
    week: async (): Promise<string> => businessWeekWords(await model()),
    'add-release': (input) => add('release', input),
    'add-customer': (input) => add('customer', input),
    'add-campaign': (input) => add('campaign', input),
    'add-support': (input) => add('support-item', input),
    'add-website': (input) => add('website', input),
    'set-field': (input) => setField(input),
    changes: async (rel, change) => {
      const c = O(change);
      await w.change(S(rel, 1000), (text) => withList(text, CHANGES_HEADING, 'What changed', { ...(typeof c.at === 'number' ? { at: c.at } : {}), ...(typeof c.words === 'string' ? { words: c.words } : {}), ...(typeof c.add === 'string' ? { add: c.add } : {}), ...(typeof c.remove === 'number' ? { remove: c.remove } : {}) }, 'change', false));
      return typeof c.remove === 'number' ? 'Took that change out. It is kept in the note’s history (File recovery).' : null;
    },
    'support-words': async (rel, key, words) => {
      const which = key === 'did' ? { heading: DID_HEADING, name: 'What we did' } : { heading: SAID_HEADING, name: 'What they said' };
      await w.change(S(rel, 1000), (text) => withSectionText(text, which.heading, which.name, typeof words === 'string' ? words.slice(0, 8000) : ''));
      return null;
    },
    'add-post': async (rel, values) => {
      const v = cleanPost(O(values));
      if (!v.title) throw new Error('Say what the post is.');
      await w.change(S(rel, 1000), (text) => tableWithRow(text, POSTS, { status: 'Draft', ...v }));
      return `Added the post ${v.title}.`;
    },
    'set-post': async (rel, row, shown, values) => {
      const v = cleanPost(O(values));
      if (v.title === '') throw new Error('A post needs its words.');
      if (typeof row !== 'number') throw new Error('That post isn’t there any more.');
      await setCells(w, S(rel, 1000), POSTS, row, typeof shown === 'string' ? shown : null, v);
      return null;
    },
    'remove-post': async (rel, row, shown) => `Took ${(await removeRow(w, S(rel, 1000), POSTS, typeof row === 'number' ? row : -1, typeof shown === 'string' ? shown : null)) || 'the post'} out. It is kept in the note’s history (File recovery).`,
    'site-check': async (rel) => {
      const m = await model();
      const site = m.websites.find((x) => x.path === S(rel, 1000));
      if (!site) throw new Error('That website isn’t there any more.');
      if (!site.url) throw new Error(`Add ${site.name}’s address first.`);
      return checkWebsite(site);
    },
    'add-check': async (rel, input) => {
      const r = S(rel, 1000);
      const o = O(input);
      const status = knownWord(WEBSITE_STATUSES, o.status) || '';
      const date = dayOf(o.date, 'the day', '2026-11-03') ?? w.todayIso();
      const note = S(o.note, 300);
      if (!status && !note) throw new Error('Choose how it was, or say what you saw.');
      await w.change(r, (text) => {
        let t = tableWithRow(text, CHECKS, { date, status, response: S(o.response, 40), note });
        if (status) t = setNoteProp(t, 'status', status);
        return setNoteProp(t, 'checked', date);
      });
      return `Noted the check on ${titleOf(r)}${status ? `: ${status.toLowerCase()}` : ''}.`;
    },
    options: async (patch) => ({ remindDays: await remindDaysOption(w, 'business', patch) }),
  };

  return {
    id: 'business',
    ops,
    async inbox(item) {
      const m = await model();
      const words = itemWords(item);
      const c = namedIn(words, m.customers, (x) => [x.name, x.email]);
      if (c) return { target: { kind: 'module', module: 'business', type: 'support-item', path: c.path, name: c.name, label: item.kind === 'line' ? `A support item from ${c.name}` : `Keep with ${c.name}` }, why: `Names the customer ${c.name}` };
      const camp = namedIn(words, m.campaigns.filter((x) => !/^(done|dropped)$/i.test(x.status)), (x) => [x.name]);
      if (camp && item.kind === 'line') return { target: { kind: 'module', module: 'business', type: 'campaign', path: camp.path, name: camp.name, label: `A post for ${camp.name}` }, why: `Names the campaign ${camp.name}` };
      return null;
    },
    async fileInbox(item, target) {
      const rel = target.path ?? '';
      const m = await model();
      if (item.kind !== 'line') return { words: `Kept ${item.path.split('/').pop()} with ${titleOf(rel)}.`, paths: [rel], keepWith: rel };
      const camp = m.campaigns.find((x) => x.path === rel);
      if (camp) {
        await w.change(rel, (text) => tableWithRow(text, POSTS, { title: item.words.trim().slice(0, 200), channel: camp.channel, status: 'Draft' }));
        return { words: `Added a post to ${camp.name}.`, paths: [rel] };
      }
      const c = m.customers.find((x) => x.path === rel);
      if (!c) throw new Error('That customer isn’t there any more.');
      const words = item.words.trim();
      const title = (words.split(/[.!?\n]/)[0] || words).replace(new RegExp(c.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), '').replace(/^[\s:,\-–—]+|[\s:,\-–—]+$/g, '').slice(0, 80) || `Question from ${c.name}`;
      const made = await w.newNote(await w.folderOf('support-item'), title, newSupportText({ customer: c.name, received: m.today, said: words }));
      return { words: `Made a support item from ${c.name}.`, paths: [made] };
    },
    async check(): Promise<WorkNotice[]> {
      const sw = w.d.prefs().modules;
      // Scheduled website checks (8.3 wave 1, 30 Oct 2026): on this regular beat, any site not checked today is
      // visited for real, so a failure is found by Ironleaf, not by a customer. Once a day per site.
      if (partOn(sw, 'business', 'sites')) {
        const before = await model();
        for (const site of before.websites.filter((x) => x.url && websiteCheckDue(x, before.today))) {
          try {
            await checkWebsite(site, 'Scheduled check');
          } catch {
            // One site's check never stops the others or the notices.
          }
        }
      }
      const m = await model();
      const out: WorkNotice[] = [];
      if (partOn(sw, 'business', 'support')) for (const s of m.openSupport.filter((x) => x.priority === 'Urgent' || (x.status === 'New' && x.priority === 'High'))) out.push({ key: `biz-support:${s.path}:${s.priority}`, kind: 'business', title: `${s.priority} support: ${s.name}`, body: [s.customer, s.product && `${s.product}${s.version ? ` ${s.version}` : ''}`].filter(Boolean).join(' · '), path: s.path });
      if (partOn(sw, 'business', 'sites')) {
        for (const site of m.websites.filter((x) => x.status === 'Down')) out.push({ key: `biz-down:${site.path}:${site.checked ?? ''}`, kind: 'business', title: `${site.name} is down`, body: site.url, path: site.path });
        for (const site of m.websites) {
          const last = [...site.checks].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))[0];
          if (last && /page words changed/i.test(last.note)) out.push({ key: `biz-changed:${site.path}:${last.date}`, kind: 'business', title: `${site.name}: its page words have changed`, body: site.url, path: site.path });
        }
        for (const r of m.renewals) out.push({ key: `biz-renew:${r.site.path}:${r.what}:${r.date}`, kind: 'business', title: `${r.site.name}: ${renewalWords(r, m.today).toLowerCase()}`, body: r.site.host || r.site.url, path: r.site.path });
      }
      return out;
    },
    async tool(name, args, ctx) {
      const mine = await model(ctx.gated);
      const refused = await refusedCount(w, ctx, TYPES);
      const on = w.isOn('business');
      const read = answerBusinessTool({ model: mine, on, refused, agent: ctx.agent }, name, args);
      if (read !== null) return read;
      if (!on) throw new Error('The Business module is off in Ironleaf (Settings › Packs).');
      if (name === 'business_release_add') {
        const version = str(args.version).slice(0, 60);
        if (!version) throw new Error('Say which version.');
        if (str(args.date) && !readDay(args.date)) throw new Error('Give the day as YYYY-MM-DD.');
        const product = str(args.product).slice(0, 80);
        const nameFor = product ? `${product} ${version}` : version;
        if (mine.releases.some((r) => r.name.toLowerCase() === nameFor.toLowerCase())) throw new Error(`${nameFor} is already in the release log.`);
        const date = readDay(args.date) ?? mine.today;
        const changes = Array.isArray(args.changes) ? (args.changes as unknown[]).map((x) => str(x).slice(0, 300)).filter(Boolean).slice(0, 60) : [];
        const rel = await agentNote(w, ctx, await w.folderOf('release'), nameFor, newReleaseText({ product, version, date, status: str(args.status) || 'Released', changes }));
        return `Logged ${nameFor} (${knownWord(RELEASE_STATUSES, args.status) || 'Released'}, ${dayWords(date, mine.today)}). [${rel}]`;
      }
      if (name === 'business_customer_add' || name === 'business_campaign_add') {
        const title = str(args.name).slice(0, 100);
        if (!title) throw new Error('It needs a name.');
        const isCustomer = name === 'business_customer_add';
        if ((isCustomer ? mine.customers : mine.campaigns).some((x) => x.name.toLowerCase() === title.toLowerCase())) throw new Error(`There’s already one called ${title}.`);
        const text = isCustomer ? newCustomerText({ contact: str(args.contact).slice(0, 100), email: str(args.email).slice(0, 120), plan: str(args.plan).slice(0, 80), status: str(args.status), since: dayOf(args.since, 'the day they started', '2026-11-03') ?? mine.today, value: money(args.value, 'what they pay'), period: str(args.period), renews: dayOf(args.renews, 'the renewal day', '2026-11-03'), source: str(args.source).slice(0, 100) }) : newCampaignText({ channel: str(args.channel), status: str(args.status), starts: dayOf(args.starts, 'the start day', '2026-11-03'), ends: dayOf(args.ends, 'the end day', '2026-11-03'), goal: str(args.goal).slice(0, 200), budget: money(args.budget, 'the budget') });
        const rel = await agentNote(w, ctx, await w.folderOf(isCustomer ? 'customer' : 'campaign'), title, text);
        return `Added ${isCustomer ? 'the customer' : 'the campaign'} ${title} to Business. [${rel}]`;
      }
      if (name === 'business_support_close') {
        const want = str(args.item).toLowerCase();
        const item = mine.support.find((x) => x.name.toLowerCase() === want || x.customer.toLowerCase() === want) ?? mine.support.filter((x) => x.name.toLowerCase().includes(want))[0];
        if (!item) throw new Error(`There is no support item called “${str(args.item)}”.`);
        if (!item.open) return `${item.name} is ${item.status.toLowerCase()} already. [${item.path}]`;
        await agentChange(w, ctx, item.path, (text) => {
          let t = setNoteProp(text, 'status', 'Closed');
          if (str(args.did)) t = withSectionText(t, DID_HEADING, 'What we did', str(args.did).slice(0, 4000));
          return t;
        });
        return `Closed ${item.name}. [${item.path}]`;
      }
      if (name === 'business_site_check') {
        const want = str(args.site).toLowerCase();
        const sites = want ? mine.websites.filter((x) => x.name.toLowerCase() === want || x.url.toLowerCase().includes(want)) : mine.websites;
        if (!sites.length) throw new Error(want ? `There is no website called “${str(args.site)}” in Business.` : 'No websites in Business yet.');
        const lines: string[] = [];
        for (const site of sites.slice(0, 10)) {
          if (!site.url) { lines.push(`${site.name}: no address written.`); continue; }
          ctx.check?.(site.path);
          lines.push(await checkWebsite(site));
        }
        return lines.join('\n');
      }
      if (name === 'business_support_add') {
        const title = str(args.title).slice(0, 100);
        if (!title) throw new Error('Give the support item a short title.');
        let customer = '';
        if (str(args.customer)) {
          const c = findCustomer(mine, args.customer);
          customer = c?.name ?? str(args.customer).slice(0, 100);
        }
        const rel = await agentNote(w, ctx, await w.folderOf('support-item'), title, newSupportText({ customer, received: mine.today, priority: str(args.priority), channel: str(args.channel), product: str(args.product).slice(0, 80), version: str(args.version).slice(0, 40), said: str(args.said).slice(0, 4000) }));
        return `Added the support item ${title}${customer ? ` from ${customer}` : ''} (${knownWord(SUPPORT_PRIORITIES, args.priority) || 'Normal'}). [${rel}]`;
      }
      return `There is no tool called ${name}.`;
    },
    rules: () => 'Business: use business_release_log, business_customer_list, business_campaign_board, business_support_open, business_site_health and business_week for the person’s own business; log a release with business_release_add, add a customer with business_customer_add or a campaign with business_campaign_add, add a customer’s problem with business_support_add and close one with business_support_close when they say it is answered, and check a website for real with business_site_check (websites are also checked on a schedule, with their certificate expiry and page words), only with what the person said (never invent changes, amounts or customers).',
  };
}
