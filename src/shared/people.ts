// People and Organisations (Wave 4, 24 Oct 2026; module 4 of the catalogue, 22 Oct: "One card per person with role,
// organisation, contact, which projects and meetings they appear in, and last contact date. Built from what's already
// in the projects (Darcy, Bettina, Arlen, Tessaly contacts and so on). Family members get their own protected
// cards."). The vault's records (src/shared/records.ts) already know every person and organisation — the ones with a
// page and the ones only named in projects, meetings and steps. This reads cards from them, finds the people named
// without a card ("12 people named in your projects"), and finds two names that are probably one person (an email both
// give; "Thad Vance" and "Thaddeus Vance"; a middle name), never by guessing on a first name alone.
//
// Pure: no files, no Node. The main side (src/main/life.ts) writes the cards and merges two into one; the window draws
// them (views/PeoplePage.tsx, the peek).

import { dayLabel, isoDay, readDay } from './days';
import { connectedTo, isOpen, personOpenItems, type RecordModel, type VaultRecord } from './records';
import { sameRecordName } from './record-match';

export interface CardRef {
  id: string;
  title: string;
  path?: string;
  date?: string;
}

/** One open action between you and a person: the record, where it is written, and the day it is due. */
export interface PersonAction {
  id: string;
  title: string;
  path: string;
  line?: number;
  date?: string;
}

/** One thing on a person's timeline: a meeting, a finished promise either way, a note, or a project. */
export interface PersonTimelineEntry {
  kind: 'meeting' | 'action' | 'note' | 'project';
  id: string;
  title: string;
  path?: string;
  line?: number;
  /** YYYY-MM-DD when it has a day (a meeting's day, a promise's due day). */
  date?: string;
  /** A promise's side: yours to do for them, or theirs to do for you. */
  side?: 'you owe' | 'they owe';
  /** A promise finished (t12, 8 Nov 2026: the Timeline keeps finished promises; open ones live only under
   *  You owe / Owes you, never twice). */
  done?: boolean;
}

/** Everything with a person as one timeline (10.0 papercuts): dated first, newest first (what's next on top), then the
 *  notes and projects with no day, by name. Open promises stay out (t12, 8 Nov 2026 — they already read under You
 *  owe / Owes you); finished ones read here. */
export function personTimeline(card: Pick<PersonCard, 'meetings' | 'doneItems' | 'notes' | 'projects'>): PersonTimelineEntry[] {
  const dated: PersonTimelineEntry[] = [];
  const undated: PersonTimelineEntry[] = [];
  const put = (e: PersonTimelineEntry) => (e.date ? dated : undated).push(e);
  for (const m of card.meetings) put({ kind: 'meeting', id: m.id, title: m.title, ...(m.path ? { path: m.path } : {}), ...(m.date ? { date: m.date } : {}) });
  for (const a of card.doneItems) put({ kind: 'action', id: a.id, title: a.title, path: a.path, ...(a.line !== undefined ? { line: a.line } : {}), ...(a.date ? { date: a.date } : {}), side: a.side, done: true });
  for (const n of card.notes) undated.push({ kind: 'note', id: n.id, title: n.title, ...(n.path ? { path: n.path } : {}) });
  for (const p of card.projects) undated.push({ kind: 'project', id: p.id, title: p.title, ...(p.path ? { path: p.path } : {}) });
  dated.sort((a, b) => b.date!.localeCompare(a.date!) || a.title.localeCompare(b.title));
  undated.sort((a, b) => a.title.localeCompare(b.title));
  return [...dated, ...undated];
}

export interface PersonCard {
  id: string;
  type: 'person' | 'org';
  name: string;
  /** Their own page, when they have one. */
  path?: string;
  page: boolean;
  role?: string;
  org?: { name: string; id?: string };
  /** The organisation to show: from their note, else read from their email's domain (29 Oct 2026, SPEC B). */
  orgName: string;
  orgFromEmail: boolean;
  email?: string;
  phone?: string;
  /** Open actions of yours that name them or are for them, and open actions that are theirs to do. */
  youOwe: number;
  owesYou: number;
  youOweItems: PersonAction[];
  owesYouItems: PersonAction[];
  /** Finished promises either way, for the Timeline (t12, 8 Nov 2026). */
  doneItems: (PersonAction & { side: 'you owe' | 'they owe' })[];
  /** The next meeting with them (today or later), when there is one. */
  nextMeeting?: CardRef;
  /** Notes that name or link to them. */
  notes: CardRef[];
  /** The projects they are in (named, own something, a contact), and the meetings they were at, newest first. */
  projects: CardRef[];
  meetings: CardRef[];
  /** The last time you met or were in touch, as far as the vault says (a meeting they were at, or their page's
   *  `last contact`), with what it was. */
  lastContact?: { date: string; what: string; id?: string };
  /** Open actions theirs to do, then open ones about them (the first few). */
  open: number;
  openItems: CardRef[];
  /** An organisation's people. */
  people: CardRef[];
  /** Gone quiet (10.0 v2locked): set when a person you used to hear from often has been silent past their
   *  usual gap. Never on organisations, yourself, or anyone with a meeting coming up. */
  quiet?: PersonQuiet;
  /** How many places name them. */
  mentions: number;
  /** Every name they go by. */
  names: string[];
  /** Where they were first named, when they have no page (a project's file). */
  namedIn?: string;
}

// ── An organisation from an email ──────────────────────────────────────────────────────────────────────────────

const DOMAIN_WORDS = new Set('new north south east west global group labs works studio digital media systems solutions technologies tech cloud data design capital partners consulting health care foods food energy power water air land home homes real estate finance financial bank insurance legal travel hotels hotel school schools city state national pacific asia australia australian zealand america american europe united first one true blue green gold silver iron peak prime apex core edge point path link net web app apps software smart bright clear open free life live work shop store stores market markets retail trade trades build builds craft crafts'.split(' '));

/** A domain's company words ("bluepeak" → "Blue Peak"): hyphen and camel splits first, then common words. */
function domainWords(stem: string): string {
  const titled = (w: string) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w);
  const parts = stem.split(/[-_]+/).flatMap((p) => p.replace(/([a-z])([A-Z])/g, '$1 $2').split(/\s+/)).filter(Boolean);
  const out: string[] = [];
  for (const part of parts) {
    if (/^[A-Z]/.test(part) || part.length < 6 || /[^a-z]/.test(part)) {
      out.push(titled(part.toLowerCase()));
      continue;
    }
    // One run of letters that is two common words ("bluepeak"): the split with the longer second word wins.
    let split: [string, string] | null = null;
    for (let i = 3; i <= part.length - 3; i++) {
      const a = part.slice(0, i);
      const b = part.slice(i);
      if (DOMAIN_WORDS.has(a) && DOMAIN_WORDS.has(b) && (!split || b.length > split[1].length)) split = [a, b];
    }
    out.push(split ? `${titled(split[0])} ${titled(split[1])}` : titled(part));
  }
  return out.join(' ');
}

/** The company an email's domain names ("sam@bluepeak.com" → "Blue Peak", "j@tessaly.com" → "Tessaly"), else nothing. */
export function organisationFromEmail(email: string | undefined | null): string | undefined {
  const host = String(email ?? '').trim().replace(/^.*@/, '').replace(/[>\s].*$/, '').split('/')[0].split(':')[0].toLowerCase();
  if (!host.includes('.')) return undefined;
  const labels = host.split('.').filter(Boolean);
  // The last label is the TLD by position (.io, .ai, .biz, .info included); then a compound registry suffix (.co.uk).
  if (labels.length > 1) labels.pop();
  const sld = /^(co|com|org|net|gov|ac|edu|asn|nic|id)$/;
  while (labels.length > 1 && sld.test(labels[labels.length - 1])) labels.pop();
  while (labels.length > 1 && /^(www|mail|email|mx|smtp|imap|pop|webmail|outlook|gmail|yahoo|hotmail|icloud|protonmail)$/.test(labels[0])) labels.shift();
  const stem = labels[labels.length - 1];
  if (!stem || sld.test(stem) || /^(gmail|outlook|hotmail|yahoo|icloud|proton|protonmail|live|msn|me|mac)$/.test(stem)) return undefined;
  return domainWords(stem) || undefined;
}

const fact = (r: VaultRecord, key: string) => r.facts.find((f) => f.key === key);
const LAST = ['last contact', 'last_contact', 'lastcontact', 'last-contact', 'last met', 'last_met', 'last spoke', 'last spoken', 'last talked', 'last seen', 'last called', 'last emailed', 'last contacted', 'last visited'];

/** A card — or anything on it — is protected when its level says family or health, or it is in the Family or
 *  Health area. One rule for the People page and the served cards (t21, 8 Nov 2026). */
export function isProtected(props: Record<string, unknown> | undefined, area: string | undefined): boolean {
  const level = String(props?.sensitivity ?? props?.level ?? '').toLowerCase();
  return /family|health/.test(level) || area === 'family' || area === 'health';
}

/** The last time you met or were in touch, as far as said (a past meeting, or the page's `last contact`): the
 *  later of the two. Shared with the served cards, which read it again once protected meetings are out. */
export function lastContactOf(meetings: CardRef[], props: Record<string, unknown> | undefined, today: string): PersonCard['lastContact'] {
  let lastContact: PersonCard['lastContact'];
  const met = meetings.find((m) => m.date && m.date <= today);
  if (met) lastContact = { date: met.date!, what: met.title, id: met.id };
  for (const k of Object.keys(props ?? {})) {
    if (!LAST.includes(k.toLowerCase())) continue;
    const raw = String((props ?? {})[k] ?? '').trim().slice(0, 30);
    // ISO as written, else an ordinary date ("20 Oct 2026"); a bare weekday or a future day is never a last contact.
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : /\d/.test(raw) ? readDay(raw, new Date()) : null;
    const v = typeof parsed === 'string' ? parsed : parsed ? isoDay(parsed) : '';
    if (v && v <= today && (!lastContact || v > lastContact.date)) lastContact = { date: v, what: 'In touch' };
  }
  return lastContact;
}

/** A person's or organisation's card from the records (null when the id isn't one). */
export function personCard(model: RecordModel, id: string, props?: Record<string, unknown>): PersonCard | null {
  const r = model.records.get(id);
  if (!r || (r.type !== 'person' && r.type !== 'org')) return null;
  const near = connectedTo(model, id);
  const items = personOpenItems(model, { id });
  const projects = near.filter((x) => x.record.type === 'project').map((x) => ({ id: x.record.id, title: x.record.title, path: x.record.path }));
  // A person named in a project's steps or contacts is in it even when nothing links them straight to the project.
  for (const x of near) {
    const p = x.record.project;
    if (!p || projects.some((q) => q.path === p)) continue;
    const pr = model.records.get(`project:${p}`);
    if (pr) projects.push({ id: pr.id, title: pr.title, path: pr.path });
  }
  const meetings = near
    .filter((x) => x.record.type === 'meeting')
    .map((x) => ({ id: x.record.id, title: x.record.title, path: x.record.path, date: x.record.date }))
    .sort((a, z) => (z.date ?? '').localeCompare(a.date ?? ''));
  const lastContact = lastContactOf(meetings, props, model.today);
  const open = items ? [...items.theirs, ...items.about] : [];
  const orgFact = fact(r, 'org');
  const email = fact(r, 'email')?.value;
  const fromEmail = orgFact ? undefined : organisationFromEmail(email);
  const toAction = (x: (typeof open)[number]): PersonAction => ({ id: x.id, title: x.title, path: x.path, ...(x.line !== undefined ? { line: x.line } : {}), ...(x.due ? { date: x.due } : {}) });
  const youOweItems = (items?.about ?? []).map(toAction);
  const owesYouItems = (items?.theirs ?? []).map(toAction);
  const doneItems: PersonCard['doneItems'] = [
    ...(items?.doneTheirs ?? []).map((x): PersonCard['doneItems'][number] => ({ ...toAction(x), side: 'they owe' })),
    ...(items?.doneAbout ?? []).map((x): PersonCard['doneItems'][number] => ({ ...toAction(x), side: 'you owe' })),
  ];
  const people = r.type === 'org' ? near.filter((x) => x.record.type === 'person').map((x) => ({ id: x.record.id, title: x.record.title, path: x.record.page ? x.record.path : undefined })) : [];
  const upcoming = meetings.filter((m) => m.date && m.date >= model.today).sort((a, z) => (a.date ?? '').localeCompare(z.date ?? ''))[0];
  const self = isMe(model, r);
  const quiet = r.type === 'person' && !self ? personQuiet({ meetings, ...(lastContact ? { lastContact } : {}), ...(upcoming ? { nextMeeting: upcoming } : {}) }, model.today) : null;
  return {
    id,
    type: r.type,
    name: r.title,
    ...(r.page ? { path: r.path } : { namedIn: r.path }),
    page: !!r.page,
    ...(fact(r, 'role') ? { role: fact(r, 'role')!.value } : {}),
    ...(orgFact ? { org: { name: orgFact.value, ...(orgFact.ref ? { id: orgFact.ref } : {}) } } : {}),
    orgName: orgFact?.value ?? fromEmail ?? '',
    orgFromEmail: !!fromEmail,
    ...(email ? { email } : {}),
    ...(fact(r, 'phone') ? { phone: fact(r, 'phone')!.value } : {}),
    youOwe: youOweItems.length,
    owesYou: owesYouItems.length,
    youOweItems,
    owesYouItems,
    doneItems,
    ...(upcoming ? { nextMeeting: upcoming } : {}),
    notes: dedupe(near.filter((x) => x.record.type === 'note').map((x) => ({ id: x.record.id, title: x.record.title, path: x.record.page ? x.record.path : undefined }))).sort((a, z) => a.title.localeCompare(z.title)).slice(0, 12),
    projects: dedupe(projects).sort((a, z) => a.title.localeCompare(z.title)),
    meetings,
    ...(lastContact ? { lastContact } : {}),
    ...(quiet ? { quiet } : {}),
    open: open.filter(isOpen).length,
    openItems: open.slice(0, 5).map((x) => ({ id: x.id, title: x.title, path: x.path, date: x.due })),
    people: dedupe(people),
    mentions: near.length,
    names: [...new Set([r.title, ...(r.names ?? [])])],
  };
}

const isMe = (model: RecordModel, r: VaultRecord) => !!model.me && r.type === 'person' && [r.title, ...(r.names ?? [])].some((n) => n.toLowerCase() === model.me!.toLowerCase());

function dedupe<T extends { id: string }>(list: T[]): T[] {
  const seen = new Set<string>();
  return list.filter((x) => !seen.has(x.id) && !!seen.add(x.id));
}

/** Every person and organisation in the vault, as cards (people first, by name). */
export function personCards(model: RecordModel, propsOf: (path: string) => Record<string, unknown> | undefined = () => undefined): PersonCard[] {
  const out: PersonCard[] = [];
  for (const r of model.records.values()) {
    if (r.type !== 'person' && r.type !== 'org') continue;
    // The person themselves, named in their own projects, isn't one of their people unless they made a card for it.
    if (!r.page && isMe(model, r)) continue;
    const c = personCard(model, r.id, r.page ? propsOf(r.path) : undefined);
    if (c) out.push(c);
  }
  return out.sort((a, z) => (a.type === z.type ? a.name.localeCompare(z.name) : a.type === 'person' ? -1 : 1));
}

// ── Person tabs ──────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * A person or organisation's tab path: the people tab's `person:` marker plus their record id, never doubled
 * (9 Nov 2026, graph feel: PersonCard.id already carries `person:`, and openPerson added it again, so every
 * person tab read `person:person:…` and Ctrl+G centred the graph on nothing). Idempotent: a record id, a bare
 * key or an old doubled id all land on the one clean path. Organisations keep their page under the same marker.
 */
export function personTabPath(id: string): string {
  return `person:${id.replace(/^(person:)+/, '')}`;
}

/**
 * A person tab's record id: the tab marker off, the record's own prefix kept. Old doubled tabs
 * (`person:person:…`, saved before personTabPath) heal to the same record their page always read.
 */
export function personRecordIdOfTab(tabPath: string | undefined): string {
  const rest = (tabPath ?? '').replace(/^(person:)+/, '');
  return rest.startsWith('org:') ? rest : `person:${rest}`;
}

// ── Gone quiet ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** How long since last contact counts as quiet: the usual gap between contacts, at least this, at most the ceiling. */
export const QUIET_FLOOR_DAYS = 30;
export const QUIET_CEILING_DAYS = 90;
/** The threshold when only one contact is known (no usual gap to read from it). */
export const QUIET_DEFAULT_DAYS = 45;

export interface PersonQuiet {
  /** Days since the last contact. */
  days: number;
  /** The usual gap between contacts, in days. Absent when only one contact is known. */
  usualDays?: number;
}

const dayNo = (iso: string): number | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? Math.round(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000) : null;
};

/**
 * Whether a person has gone quiet (10.0 v2locked, plan item 25): someone you used to hear from often and have not
 * in a while. Contacts are past meeting dates plus the last-contact date; the usual gap is the median gap between
 * them, kept between the floor and the ceiling. Null when there is nothing to go quiet from (no contacts), when
 * they are only as silent as usual, or when a meeting is coming up (the exclusion for organisations and yourself
 * lives in personCard, which knows the type and the model).
 */
export function personQuiet(card: Pick<PersonCard, 'meetings' | 'lastContact' | 'nextMeeting'>, today: string): PersonQuiet | null {
  const now = dayNo(today);
  if (now === null) return null;
  if (card.nextMeeting?.date) {
    const n = dayNo(card.nextMeeting.date);
    if (n !== null && n >= now) return null;
  }
  const dates = new Set<string>();
  for (const m of card.meetings) {
    const d = m.date ? dayNo(m.date) : null;
    if (d !== null && d <= now) dates.add(m.date!);
  }
  if (card.lastContact?.date) {
    const d = dayNo(card.lastContact.date);
    if (d !== null && d <= now) dates.add(card.lastContact.date);
  }
  if (!dates.size) return null;
  const sorted = [...dates].sort();
  const last = dayNo(sorted[sorted.length - 1])!;
  const days = now - last;
  if (sorted.length < 2) return days > QUIET_DEFAULT_DAYS ? { days } : null;
  const gaps = sorted.slice(1).map((d, i) => dayNo(d)! - dayNo(sorted[i])!);
  gaps.sort((a, b) => a - b);
  const usual = gaps.length % 2 ? gaps[(gaps.length - 1) / 2] : Math.round((gaps[gaps.length / 2 - 1] + gaps[gaps.length / 2]) / 2);
  const threshold = Math.min(QUIET_CEILING_DAYS, Math.max(QUIET_FLOOR_DAYS, usual));
  return days > threshold ? { days, usualDays: usual } : null;
}

/** One line to reopen the conversation, for the brief and the person page. Drafted, never sent by itself. */
export function checkInDraft(card: Pick<PersonCard, 'name' | 'owesYouItems' | 'youOweItems' | 'lastContact'>): string {
  const first = card.name.trim().split(/\s+/)[0] || 'there';
  const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim().replace(/[.。]+$/, '').slice(0, 80);
  const hook = oneLine(card.owesYouItems[0]?.title ?? card.youOweItems[0]?.title ?? '');
  if (hook) return `Hi ${first}, how did ${hook} go?`;
  const what = card.lastContact && card.lastContact.what !== 'In touch' ? oneLine(card.lastContact.what) : '';
  if (what) return `Hi ${first}, how did things go after ${what}?`;
  return `Hi ${first}, it has been a while. How have you been?`;
}

/** A quiet person as the brief carries them: the line's facts plus the drafted check-in. */
export interface QuietBriefPerson {
  id: string;
  name: string;
  path?: string;
  days: number;
  usualDays?: number;
  draft: string;
}

/** Every quiet card, longest silent first, each with its drafted check-in. */
export function quietBriefPeople(cards: readonly PersonCard[]): QuietBriefPerson[] {
  return cards
    .filter((c) => c.quiet)
    .sort((a, z) => z.quiet!.days - a.quiet!.days || a.name.localeCompare(z.name))
    .map((c) => ({ id: c.id, name: c.name, ...(c.path ? { path: c.path } : {}), days: c.quiet!.days, ...(c.quiet!.usualDays !== undefined ? { usualDays: c.quiet!.usualDays } : {}), draft: checkInDraft(c) }));
}

// ── Cards to make ───────────────────────────────────────────────────────────────────────────────────────────────────

export interface CardSuggestion {
  id: string;
  type: 'person' | 'org';
  name: string;
  role?: string;
  /** The projects they are named in (each project file's path), the most first. */
  projects: string[];
  /** How many places name them. */
  mentions: number;
}

/** The people and organisations named in the vault's projects and meetings without a card of their own, the most
 *  named first. An organisation only when something says it is one (a contacts table, someone's organisation). */
export function cardSuggestions(model: RecordModel): CardSuggestion[] {
  const out: CardSuggestion[] = [];
  for (const r of model.records.values()) {
    if ((r.type !== 'person' && r.type !== 'org') || r.page) continue;
    // The person themselves (the owner of most projects) can make their own card; it isn't offered.
    if (isMe(model, r)) continue;
    const near = connectedTo(model, r.id);
    const projects = new Map<string, number>();
    for (const x of near) {
      const p = x.record.type === 'project' ? x.record.path : x.record.project;
      if (p) projects.set(p, (projects.get(p) ?? 0) + 1);
    }
    if (!projects.size && !near.some((x) => x.record.type === 'meeting')) continue;
    out.push({
      id: r.id,
      type: r.type,
      name: r.title,
      ...(fact(r, 'role') ? { role: fact(r, 'role')!.value } : {}),
      projects: [...projects].sort((a, z) => z[1] - a[1]).map(([p]) => p),
      mentions: near.length,
    });
  }
  return out.sort((a, z) => z.mentions - a.mentions || a.name.localeCompare(z.name));
}

// ── Two names, one person ───────────────────────────────────────────────────────────────────────────────────────────

export interface SamePerson {
  /** The one kept (with a page, else the most named) and the other. */
  keep: string;
  other: string;
  keepName: string;
  otherName: string;
  why: string;
  /** What a merge would move (9 Nov 2026, one person one page): filled by the main side, which counts links. */
  preview?: MergePreview;
}

/** What a merge moves: notes, meetings, mentions, links and tasks owned. */
export interface MergePreview {
  notes: number;
  meetings: number;
  mentions: number;
  links: number;
  tasksOwned: number;
}

const pairKey = (a: string, b: string) => [a, b].sort().join('|');
export const samePairKey = pairKey;

const nameParts = (name: string) =>
  name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^\p{L}\s'-]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);

/** Common English short forms a shared start cannot catch ("Bob" is short for "Robert"), first names only. */
const NICKNAME_PAIRS: [string, string][] = [
  ['bob', 'robert'],
  ['bill', 'william'],
  ['jim', 'james'],
  ['mike', 'michael'],
  ['dave', 'david'],
  ['steve', 'steven'],
  ['steve', 'stephen'],
  ['chris', 'christopher'],
  ['matt', 'matthew'],
  ['dan', 'daniel'],
  ['tom', 'thomas'],
  ['nick', 'nicholas'],
  ['liz', 'elizabeth'],
  ['kate', 'katherine'],
];

/** Whether two names are one person's: the same first and last names with a middle name or initial between, a short
 *  first name of the long one ("Thad" and "Thaddeus", "B" and "Bettina") with the same last name, a last initial for the
 *  last name ("Alex M" is Alex Morgan), or a common nickname ("Bob" is short for "Robert"). */
function sameName(a: string, b: string): string | null {
  const x = nameParts(a);
  const y = nameParts(b);
  if (x.length < 2 || y.length < 2) return null;
  if (x.join(' ') === y.join(' ')) return 'Same name, different spelling';
  // A last initial for the last name, when the first names match outright (Nov 2026 audit).
  if (x[0] === y[0]) {
    const [lx, ly] = [x.at(-1)!, y.at(-1)!];
    if (lx.length === 1 && ly.length > 1 && ly.startsWith(lx)) return 'A last initial for the last name';
    if (ly.length === 1 && lx.length > 1 && lx.startsWith(ly)) return 'A last initial for the last name';
  }
  if (x.at(-1) !== y.at(-1)) return null;
  const [fx, fy] = [x[0].replace(/\.$/, ''), y[0].replace(/\.$/, '')];
  if (fx === fy) return x.length !== y.length ? 'The same name, one with a middle name' : null;
  const [short, long] = fx.length < fy.length ? [fx, fy] : [fy, fx];
  if (short.length === 1 && long.startsWith(short)) return 'An initial for the first name';
  if (short.length >= 2 && long.startsWith(short)) return `${short.charAt(0).toUpperCase() + short.slice(1)} is short for ${long.charAt(0).toUpperCase() + long.slice(1)}`;
  if (NICKNAME_PAIRS.some(([n, full]) => (fx === n && fy === full) || (fx === full && fy === n))) return `${short.charAt(0).toUpperCase() + short.slice(1)} is short for ${long.charAt(0).toUpperCase() + long.slice(1)}`;
  return null;
}

/** An address as written ("Sam <sam@x.com>", "mailto:sam@x.com") down to the address, for comparing. */
const cleanEmail = (v: string | undefined): string | undefined => {
  const e = v?.replace(/^mailto:/i, '').replace(/^.*<([^<>]*)>.*$/, '$1').trim().toLowerCase();
  return e || undefined;
};

/** A name's words for first-name work ("Darcy-Lin" reads two): accents off, case and punctuation folded. */
const cleanWords = (s: string): string[] => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);

/** Every address a card gives (a work and a personal address each count): split, then cleaned. */
const emailsOf = (r: VaultRecord): string[] => {
  const v = fact(r, 'email')?.value;
  if (!v) return [];
  return v.split(/[,;]+/).map(cleanEmail).filter((e): e is string => !!e);
};

const allNames = (r: VaultRecord): string[] => [...new Set([r.title, ...(r.names ?? [])])];

/** People who are probably one person, each pair once, leaving out pairs the person said aren't the same. A name that
 *  could be either of two people ("D. Lam" with a Darcy Lin and a Dana Lam) is never offered. No model call: the
 *  vault's own data only (9 Nov 2026, one person one page). The same email; the same full name in different case or
 *  punctuation; a first name used only where one known person fits (in the same project or meeting); and names on the
 *  known as list. Two different people with the same first name are never suggested without that second reason. */
export function samePeople(model: RecordModel, notSame: ReadonlySet<string> = new Set()): SamePerson[] {
  const people = [...model.records.values()].filter((r) => r.type === 'person');
  // The one kept: the one with a page, then the full name (a single first name never keeps over a full one),
  // then the fuller card (its role, organisation, contact), then the most named.
  const weight = (r: VaultRecord) => (r.page ? 1000 : 0) + (cleanWords(r.title).length >= 2 ? 500 : 0) + r.facts.length * 10 + (model.adj.get(r.id)?.length ?? 0);
  const found = new Map<string, { a: VaultRecord; b: VaultRecord; why: string }[]>();
  // Full people by first word, for first-name work (single-word cards never stand here: they are the ones matched).
  const fullByFirst = new Map<string, VaultRecord[]>();
  for (const r of people) {
    const w = cleanWords(r.title);
    if (w.length < 2) continue;
    const list = fullByFirst.get(w[0]) ?? [];
    list.push(r);
    fullByFirst.set(w[0], list);
  }
  // A project or meeting's full people with this first word (their ids): the second reason's check.
  const firstsIn = (ctxId: string, first: string): string[] => {
    const out: string[] = [];
    for (const n of model.adj.get(ctxId) ?? []) {
      const r = model.records.get(n.id);
      if (!r || r.type !== 'person') continue;
      const w = cleanWords(r.title);
      if (w.length >= 2 && w[0] === first && !out.includes(r.id)) out.push(r.id);
    }
    return out;
  };
  const contextsOf = (id: string): string[] => (model.adj.get(id) ?? []).map((n) => n.id).filter((cid) => {
    const t = model.records.get(cid)?.type;
    return t === 'project' || t === 'meeting';
  });
  for (let i = 0; i < people.length; i++) {
    for (let j = i + 1; j < people.length; j++) {
      const a = people[i];
      const b = people[j];
      if (notSame.has(pairKey(a.id, b.id))) continue;
      const ea = emailsOf(a);
      const eb = emailsOf(b);
      const shared = ea.find((e) => eb.includes(e));
      let why: string | null = shared ? `Both give ${shared}` : null;
      // The same full name in different case or punctuation, and names on the known as list.
      if (!why) {
        const namesA = allNames(a);
        const namesB = allNames(b);
        outer: for (const na of namesA) {
          for (const nb of namesB) {
            if (!sameRecordName(na, nb)) continue;
            const naTitle = sameRecordName(na, a.title);
            const nbTitle = sameRecordName(nb, b.title);
            if (naTitle && nbTitle) {
              why = 'Same name, different spelling';
              break outer;
            }
            // Two full cards sharing a bare first name as known as ("Darcy") are two people, never one.
            if (!naTitle && !nbTitle && cleanWords(na).length < 2 && cleanWords(nb).length < 2) continue;
            why = 'On the known as list';
            break outer;
          }
        }
      }
      if (!why) for (const na of allNames(a)) for (const nb of allNames(b)) why ??= sameName(na, nb);
      // A first name used only where one known person fits: a single-word card and the one full person with
      // that first word, in every same project or meeting (never where two could fit, never on the name alone).
      if (!why) {
        const wa = cleanWords(a.title);
        const wb = cleanWords(b.title);
        const single = wa.length === 1 && wb.length >= 2 ? a : wb.length === 1 && wa.length >= 2 ? b : null;
        const full = single === a ? b : single === b ? a : null;
        if (single && full) {
          const first = cleanWords(single.title)[0];
          if (cleanWords(full.title)[0] === first && (fullByFirst.get(first) ?? []).some((r) => r.id === full.id)) {
            const ctxs = contextsOf(single.id);
            let supports = 0;
            let blocks = false;
            for (const c of ctxs) {
              const fits = firstsIn(c, first);
              if (!fits.length) continue;
              if (fits.length === 1 && fits[0] === full.id) supports++;
              else {
                blocks = true;
                break;
              }
            }
            if (!blocks && supports > 0) why = `First name where only ${full.title} fits`;
          }
        }
      }
      if (!why) continue;
      for (const r of [a, b]) found.set(r.id, [...(found.get(r.id) ?? []), { a, b, why }]);
    }
  }
  const out: SamePerson[] = [];
  const seen = new Set<string>();
  for (const list of found.values()) {
    for (const { a, b, why } of list) {
      const key = pairKey(a.id, b.id);
      if (seen.has(key)) continue;
      seen.add(key);
      // Ambiguous: the shorter name matches more than one other person (an email in common is never ambiguous).
      const shortOne = a.title.length <= b.title.length ? a : b;
      if (!why.startsWith('Both give') && (found.get(shortOne.id)?.length ?? 0) > 1) continue;
      const [keep, other] = weight(a) >= weight(b) ? [a, b] : [b, a];
      if (keep.page && other.page && keep.path === other.path) continue;
      out.push({ keep: keep.id, other: other.id, keepName: keep.title, otherName: other.title, why });
    }
  }
  return out.sort((x, y) => x.keepName.localeCompare(y.keepName));
}

/** What a merge moves, in plain words (9 Nov 2026, one person one page): notes, meetings, mentions, links, tasks owned. */
export function mergePreviewWords(p: MergePreview): string {
  const bit = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const parts: string[] = [];
  if (p.notes > 0) parts.push(bit(p.notes, 'note'));
  if (p.meetings > 0) parts.push(bit(p.meetings, 'meeting'));
  if (p.mentions > 0) parts.push(bit(p.mentions, 'mention'));
  if (p.links > 0) parts.push(bit(p.links, 'link'));
  if (p.tasksOwned > 0) parts.push(bit(p.tasksOwned, 'task owned', 'tasks owned'));
  return parts.length ? `Moves ${parts.join(', ')}.` : 'Nothing to move yet.';
}

// ── Writing a card ──────────────────────────────────────────────────────────────────────────────────────────────────

/** Which names in a make-cards run are new, one flag per name: true for the first spelling of a name with no card,
 *  false for repeats inside the run and names already on a card. Skipped names are never re-made as "Name 2". */
export function pickNewCards(names: readonly string[], cardTitles: readonly string[]): boolean[] {
  return names.map((name, i) => {
    if (!name.trim()) return false;
    if (names.slice(0, i).some((p) => sameRecordName(p, name))) return false;
    return !cardTitles.some((t) => sameRecordName(t, name));
  });
}

const yamlText = (v: string) => (/^[\w .,'()&-]+$/.test(v) && !/^(true|false|null|yes|no|\d+)$/i.test(v.trim()) && !/^[-?:,[\]{}#&*!|>'"%@`]/.test(v) ? v : JSON.stringify(v));

/** A new card's words: its type, role and organisation, its area when it isn't in the area's folder, the protected
 *  level for family, the projects it was named in, and the usual sections. */
export function cardText(s: { name: string; type: 'person' | 'org'; role?: string; org?: string; email?: string; area?: string; sensitivity?: string; projects?: string[] }): string {
  const front = [`type: ${s.type === 'org' ? 'organisation' : 'person'}`];
  if (s.role) front.push(`role: ${yamlText(s.role)}`);
  if (s.org && s.type === 'person') front.push(`org: ${yamlText(s.org)}`);
  if (s.email) front.push(`email: ${yamlText(s.email)}`);
  if (s.area) front.push(`area: ${yamlText(s.area)}`);
  if (s.sensitivity) front.push(`sensitivity: ${yamlText(s.sensitivity)}`);
  const named = (s.projects ?? []).map((p) => `[[${(p.split('/').pop() ?? p).replace(/\.md$/i, '')}]]`);
  const lines = ['---', ...front, '---', `# ${s.name}`, ''];
  if (named.length) lines.push(`Named in ${named.join(', ')}.`, '');
  lines.push('## About', '', '', '## Notes', '', '');
  return lines.join('\n');
}

/**
 * A next meeting's day in words (Polish round 4, 29 Oct 2026): "today", "tomorrow", else the day itself
 * ("Fri 30 Oct"). A future day is never called today, and a past day keeps its own date.
 */
export function nextMeetingWords(iso: string, today: string): string {
  const dayNumber = (s: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); return m ? Math.round(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000) : null; };
  const [a, b] = [dayNumber(iso), dayNumber(today)];
  if (a === null || b === null) return iso;
  if (a === b) return 'today';
  if (a === b + 1) return 'tomorrow';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)!;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const todayParts = /^(\d{4})-(\d{2})-(\d{2})/.exec(today);
  return dayLabel(d, todayParts ? new Date(Number(todayParts[1]), Number(todayParts[2]) - 1, Number(todayParts[3])) : d);
}

export type PeopleFilter = 'all' | 'owes-you' | 'you-owe' | 'recent';

/** People for one filter and search (29 Oct 2026, SPEC B): met recently is a last meeting or contact within 30 days. */
export function filterPeople<C extends PersonCard>(cards: readonly C[], filter: PeopleFilter, today: string, query = ''): C[] {
  const q = query.trim().toLowerCase();
  const recentFrom = (() => { const d = new Date(`${today}T12:00:00`); d.setDate(d.getDate() - 30); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
  return cards.filter((c) => {
    if (filter === 'owes-you' && !c.owesYou) return false;
    if (filter === 'you-owe' && !c.youOwe) return false;
    if (filter === 'recent' && !(c.lastContact && c.lastContact.date >= recentFrom && c.lastContact.date <= today)) return false;
    if (q && ![c.name, ...c.names, c.role ?? '', c.orgName, c.email ?? '', ...c.projects.map((p) => p.title), ...c.meetings.map((m) => m.title), ...c.notes.map((n) => n.title)].some((s) => s.toLowerCase().includes(q))) return false;
    return true;
  });
}

/** Most to act on first: the most open between you, then the soonest due, then the next meeting, then the name. */
export function sortPeopleByAction<C extends PersonCard>(cards: readonly C[]): C[] {
  const soonest = (c: PersonCard) => [...c.youOweItems, ...c.owesYouItems].map((x) => x.date).filter((d): d is string => !!d).sort()[0] ?? '9999-12-31';
  return [...cards].sort((a, z) => (z.youOwe + z.owesYou) - (a.youOwe + a.owesYou) || soonest(a).localeCompare(soonest(z)) || (a.nextMeeting?.date ?? '9999-12-31').localeCompare(z.nextMeeting?.date ?? '9999-12-31') || a.name.localeCompare(z.name));
}

/** The heading a merged card's words go under ("## From Thad Vance (merged 24 Oct 2026)"). */
export const mergedHeading = (name: string, day: string) => `## From ${name} (merged ${day})`;
