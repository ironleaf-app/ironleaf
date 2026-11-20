// Modules with a purpose (8.0 SPEC section D, 29 Oct 2026): every module page leads with what needs the person,
// in one order everywhere, and its numbers' words say where the figure comes from. Pure: no files, no Node, no DOM.

/** One thing that may need the person, as every module page orders it: its words and the day it falls. */
export interface AttentionItem {
  title: string;
  /** YYYY-MM-DD, or null when it has no day. */
  due: string | null;
  done?: boolean;
}

/** What needs the person first (8.0 section D): overdue first, most overdue first, then today, then what is
 *  coming up soonest first, then the rest by day, and things with no day last. Done things are left out.
 *  The order is stable, so two things due the same day keep the order they were given in. */
export function attentionOrder<T extends AttentionItem>(items: readonly T[], today: string): T[] {
  const rank = (due: string | null) => (due === null ? 3 : due < today ? 0 : due === today ? 1 : 2);
  return items
    .filter((i) => !i.done)
    .map((item, at) => ({ item, at }))
    .sort((a, b) => rank(a.item.due) - rank(b.item.due) || (a.item.due ?? '9999').localeCompare(b.item.due ?? '9999') || a.at - b.at)
    .map((x) => x.item);
}

/** Finance's spent words (8.0 section D: no contradictions in its numbers' words). Beside a figure they say
 *  where it comes from; with nothing recorded they say so, and only then mention the import. */
export function spentLine(total: number, entries: number, month: string): string {
  void total;
  if (entries <= 0) return `Nothing recorded for ${month} yet. Add what you spend, or import your bank's CSV, to see it here.`;
  return `From ${entries} ${entries === 1 ? 'entry' : 'entries'} recorded for ${month}.`;
}

/** Days from one YYYY-MM-DD day to another (negative when the second is earlier), or null without two days. */
export function daysBetweenDays(from: string | null | undefined, to: string | null | undefined): number | null {
  if (!from || !to) return null;
  const a = Date.parse(`${from.slice(0, 10)}T12:00:00Z`);
  const b = Date.parse(`${to.slice(0, 10)}T12:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

/** When a day falls, in the words a Needs-you card shows (8.0 round 2): "3 days late", "today", "tomorrow",
 *  "in 5 days". No day, no words. */
export function whenWords(due: string | null | undefined, today: string): string {
  const n = daysBetweenDays(today, due);
  if (n === null) return '';
  if (n < 0) return n === -1 ? '1 day late' : `${-n} days late`;
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  return `in ${n} days`;
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A day as a person reads it ("3 Dec 2026", with no year when it is this one). */
export function dayWords(iso: string | null | undefined, today?: string): string {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.slice(0, 10));
  if (!m) return iso;
  const year = today && m[1] === today.slice(0, 4) ? '' : ` ${m[1]}`;
  return `${Number(m[3])} ${MONTHS_SHORT[Number(m[2]) - 1]}${year}`;
}

/** One card in a module's Needs-you lead (8.0 round 2): what, when, the detail that matters, and its one action.
 *  `ref` is the record it came from (its path or id), so the page's button does that record's thing. */
export interface NeedsCard {
  id: string;
  title: string;
  /** YYYY-MM-DD, or null when it needs the person without a day (an open support item, a habit not yet ticked). */
  due: string | null;
  detail?: string;
  /** The one button's words ("Mark paid", "Renew", "Open", "Log it", "Send"). */
  action: string;
  ref?: string;
  /** Needs the person even though its day is more than 14 days off, or it has no day (off track, waiting, down). */
  offTrack?: boolean;
}

/** What leads a module page (8.0 round 2): what is overdue, due today, due within 14 days, or off track, in
 *  `attentionOrder`'s order (overdue first), at most 4. Done things never reach here: each builder leaves them out. */
export function selectNeeds(cards: readonly NeedsCard[], today: string, limit = 4): NeedsCard[] {
  void today;
  const qualifies = (c: NeedsCard) => {
    if (c.offTrack) return true;
    const n = daysBetweenDays(today, c.due);
    return n !== null && n <= 14;
  };
  return attentionOrder(cards.filter(qualifies).map((c) => ({ title: c.title, due: c.due, card: c })), today)
    .slice(0, Math.max(0, limit))
    .map((x) => x.card);
}

/** The next dated thing after the Needs-you window, for the calm line (the soonest future day, done or not aside). */
export function nextNeedsDate(cards: readonly NeedsCard[], today: string): NeedsCard | null {
  const future = cards.filter((c) => c.due && c.due > today).sort((a, b) => (a.due ?? '').localeCompare(b.due ?? ''));
  return future[0] ?? null;
}

/** The calm line when nothing needs the person (8.0 round 2), with the module's next date when it has one. */
export function nothingNeedsYou(next: NeedsCard | null, today: string): string {
  if (!next?.due) return 'Nothing needs you here this week.';
  return `Nothing needs you here this week. Next: ${next.title}, ${whenWords(next.due, today)} (${dayWords(next.due, today)}).`;
}

const needsCard = (id: string, title: string, due: string | null, action: string, detail?: string, ref?: string, offTrack?: boolean): NeedsCard => ({
  id,
  title,
  due,
  action,
  ...(detail ? { detail } : {}),
  ...(ref ? { ref } : {}),
  ...(offTrack ? { offTrack } : {}),
});

// ── One builder per module kind (8.0 round 2): each module's own records in, its Needs-you cards out. ──────────────

/** Finance: bills due. An autopay bill due soon is shown (it is money going out) but opens instead of asking to be
 *  marked paid — it pays itself; one past its day with no confirmation may not have gone through, and is marked paid
 *  like any overdue bill (9.2). The detail is its amount and account. */
export function financeNeeds(bills: readonly { name: string; path?: string; next: string | null; amount: number | null; account?: string | null; autopay?: boolean; overdue?: boolean }[], today: string, money: (n: number) => string = (n) => `$${n}`): NeedsCard[] {
  void today;
  const all = bills.map((b) => {
    const auto = b.autopay === true;
    const action = auto && !b.overdue ? 'Open' : 'Mark paid';
    const detail = [auto ? 'Autopay' : '', b.amount !== null ? money(b.amount) : 'No amount yet', b.account].filter(Boolean).join(' · ');
    return needsCard(`bill:${b.path ?? b.name}`, b.name, b.next, action, detail, b.path);
  });
  return all;
}

/** Documents and ID: documents and IDs expiring (or already expired). */
export function documentsNeeds(docs: readonly { name: string; path?: string; kind?: string; issuer?: string; expires: string | null }[], today: string): NeedsCard[] {
  void today;
  const all = docs.filter((d) => d.expires).map((d) => needsCard(`doc:${d.path ?? d.name}`, d.name, d.expires, 'Renew', [d.kind, d.issuer].filter(Boolean).join(' · '), d.path));
  return all;
}

/** Sites and Equipment: warranties and ends of life coming, and patch work due. */
export function sitesNeeds(lifecycle: readonly { device: string; path?: string; what: string; date: string | null }[], patch: readonly { title: string; path?: string; due: string | null }[], today: string): NeedsCard[] {
  void today;
  const all = [
    ...lifecycle.map((l) => needsCard(`life:${l.path ?? l.device}:${l.what}`, `${l.device}: ${l.what.toLowerCase()}`, l.date, 'Open', undefined, l.path)),
    ...patch.map((p) => needsCard(`patch:${p.path ?? p.title}`, p.title, p.due, 'Open', 'Patch work', p.path)),
  ];
  return all;
}

/** Vendors, Quotes and Contracts: quotes waiting (open, lapsing) and contracts and warranties ending. */
export function vendorsNeeds(quotes: readonly { name: string; path?: string; vendor?: string; validUntil: string | null; amount?: number | null; open?: boolean }[], contracts: readonly { name: string; path?: string; vendor?: string; ends: string | null; amount?: number | null }[], today: string, money: (n: number) => string = (n) => `$${n}`): NeedsCard[] {
  void today;
  const all = [
    ...quotes.filter((q) => q.open !== false).map((q) => needsCard(`quote:${q.path ?? q.name}`, q.vendor ? `${q.vendor}: quote` : q.name, q.validUntil, 'Open', q.amount !== null && q.amount !== undefined ? money(q.amount) : undefined, q.path)),
    ...contracts.map((c) => needsCard(`contract:${c.path ?? c.name}`, c.vendor ? `${c.vendor}: contract` : c.name, c.ends, 'Open', c.amount !== null && c.amount !== undefined ? money(c.amount) : undefined, c.path)),
  ];
  return all;
}

/** Weekly Updates: this week's update, when it has not been sent this week. */
export function weeklyNeeds(current: { week: string; status: string; sent?: string | null; path?: string } | null, thisWeek: string, dueDay: string | null, today: string): NeedsCard[] {
  void thisWeek; void today;
  if (current && (current.status === 'Sent' || current.sent)) return [];
  const all = [needsCard('weekly:this', "This week's update", dueDay, 'Send', current ? 'Draft, not sent yet' : 'Not started yet', current?.path, true)];
  return all;
}

/** Business: domains and certificates expiring, customer renewals, and open support (urgent first by its day). */
export function businessNeeds(renewals: readonly { name: string; path?: string; date: string; kind?: string }[], support: readonly { title: string; path?: string; customer?: string; priority?: string; received?: string | null }[], today: string): NeedsCard[] {
  void today;
  const all = [
    ...renewals.map((r) => needsCard(`renew:${r.path ?? r.name}:${r.date}`, r.name, r.date, 'Open', r.kind, r.path)),
    ...support.map((s) => needsCard(`support:${s.path ?? s.title}`, s.title, s.received ?? null, 'Open', [s.customer, s.priority].filter(Boolean).join(' · '), s.path, true)),
  ];
  return all;
}

/** Systems and Home Lab: runbooks due, machines or services that are down, and machines that cannot be checked yet
 *  (30 Oct 2026, fourth pass: never checked needs its login, with an Add its login button). */
export function systemsNeeds(runbooks: readonly { name: string; path?: string; nextDue: string | null }[], trouble: readonly { name: string; path?: string; status: string }[], today: string, attention: readonly { name?: string; path?: string; title: string; action: string }[] = []): NeedsCard[] {
  void today;
  const all = [
    ...runbooks.map((r) => needsCard(`runbook:${r.path ?? r.name}`, r.name, r.nextDue, 'Open', 'Runbook due', r.path)),
    ...trouble.map((t) => needsCard(`trouble:${t.path ?? t.name}`, `${t.name} is ${t.status.toLowerCase()}`, null, 'Open', undefined, t.path, true)),
    ...attention.map((a) => needsCard(a.action === 'Add its login' ? `needs-login:${a.path ?? a.title}` : `attention:${a.path ?? a.title}`, a.title, null, a.action, undefined, a.path, true)),
  ];
  return all;
}

/** Goals and Habits: milestones due, habits not yet ticked today, and goals off track. */
export function goalsNeeds(milestones: readonly { title: string; goalName?: string; path?: string; due: string | null; done?: boolean }[], habits: readonly { name: string; path?: string; doneToday?: boolean }[], offTrack: readonly { name: string; path?: string; status?: string; nextDue?: string | null }[], today: string): NeedsCard[] {
  void today;
  const all = [
    ...milestones.filter((m) => !m.done).map((m) => needsCard(`milestone:${m.path ?? m.title}`, m.title, m.due, 'Open', m.goalName, m.path)),
    ...habits.filter((h) => !h.doneToday).map((h) => needsCard(`habit:${h.path ?? h.name}`, h.name, today, 'Log it', 'Habit for today', h.path)),
    ...offTrack.map((g) => needsCard(`goal:${g.path ?? g.name}`, g.name, g.nextDue ?? null, 'Open', g.status, g.path, true)),
  ];
  return all;
}

/** Memories and Media: creative projects due and not done. */
export function memoriesNeeds(creative: readonly { name: string; path?: string; due: string | null; status?: string }[], today: string): NeedsCard[] {
  void today;
  const done = /^(done|sent|finished|printed)$/i;
  const all = creative.filter((c) => !done.test(c.status ?? '')).map((c) => needsCard(`creative:${c.path ?? c.name}`, c.name, c.due, 'Open', c.status, c.path));
  return all;
}

/** Reading, Watching and Lists: what is under way (watching, reading, listening) needs finishing, with no day. */
export function listsNeeds(doing: readonly { title: string; listName?: string; path?: string; kind?: string }[], today: string): NeedsCard[] {
  void today;
  const all = doing.map((i) => needsCard(`item:${i.path ?? i.title}`, i.title, null, 'Open', i.listName, i.path, true));
  return all;
}

/** Career: follow-ups due and interviews coming (certificates and licences ride along as dated follow-ups). */
export function careerNeeds(followUps: readonly { name: string; path?: string; company?: string; nextDate: string | null; nextStep?: string }[], interviews: readonly { name: string; path?: string; company?: string; date: string | null }[], today: string): NeedsCard[] {
  void today;
  const all = [
    ...followUps.map((a) => needsCard(`follow:${a.path ?? a.name}`, a.company || a.name, a.nextDate, 'Open', a.nextStep, a.path)),
    ...interviews.map((i) => needsCard(`interview:${i.path ?? i.name}`, i.company ? `Interview: ${i.company}` : i.name, i.date, 'Open', undefined, i.path)),
  ];
  return all;
}

/** Travel: trips coming up (and the one you are on now, due today). */
export function travelNeeds(trips: readonly { name: string; path?: string; starts: string | null; ends?: string | null; phase?: string }[], today: string): NeedsCard[] {
  void today;
  const all = trips
    .filter((t) => t.phase !== 'Back' && t.phase !== 'Cancelled')
    .map((t) => needsCard(`trip:${t.path ?? t.name}`, t.name, t.phase === 'Away' ? today : t.starts, 'Open', t.phase === 'Away' ? 'You are away now' : undefined, t.path));
  return all;
}

/** House (Home): maintenance due and warranties ending. */
export function houseNeeds(jobs: readonly { name: string; path?: string; nextDue: string | null; state?: string }[], warranties: readonly { name: string; path?: string; warranty: string | null }[], today: string): NeedsCard[] {
  void today;
  const all = [
    ...jobs.filter((j) => j.state !== 'Done' && j.state !== 'Paused').map((j) => needsCard(`job:${j.path ?? j.name}`, j.name, j.nextDue, 'Open', 'Maintenance', j.path)),
    ...warranties.map((a) => needsCard(`warranty:${a.path ?? a.name}`, `${a.name}: warranty`, a.warranty, 'Open', undefined, a.path)),
  ];
  return all;
}

/** Vehicles: rego, insurance and service due (equipment or vehicle service due). */
export function vehiclesNeeds(dues: readonly { vehicle: string; path?: string; what: string; date: string | null; detail?: string }[], today: string): NeedsCard[] {
  void today;
  const all = dues.map((d) => needsCard(`due:${d.path ?? d.vehicle}:${d.what}`, `${d.vehicle}: ${d.what.toLowerCase()}`, d.date, 'Open', d.detail, d.path));
  return all;
}

/** Publications: the next edition, when it is due (or overdue and not sent). */
export function publicationsNeeds(next: { label: string; path?: string; date: string | null; status?: string } | null, today: string): NeedsCard[] {
  void today;
  if (!next || /^(sent|printed|published)$/i.test(next.status ?? '')) return [];
  const all = [needsCard(`edition:${next.path ?? next.label}`, next.label, next.date, 'Open', next.status, next.path, !!next.date && next.date < today)];
  return all;
}

/** Family: events and birthdays coming up in the next 14 days. */
export function familyNeeds(events: readonly { what: string; who?: string; date: string }[], birthdays: readonly { name: string; day: string }[], today: string): NeedsCard[] {
  void today;
  const all = [
    ...events.map((e) => needsCard(`event:${e.date}:${e.what}`, e.what, e.date, 'Open', e.who)),
    ...birthdays.map((b) => needsCard(`birthday:${b.name}:${b.day}`, `${b.name}'s birthday`, b.day, 'Open')),
  ];
  return all;
}

/** Health: appointments coming, today's check-in when it is due, and habits not yet ticked today. */
export function healthNeeds(appointments: readonly { title: string; date: string | null }[], checkinDue: boolean, habits: readonly { name: string; doneToday?: boolean }[], today: string): NeedsCard[] {
  void today;
  const all = [
    ...appointments.map((a) => needsCard(`appt:${a.title}:${a.date ?? ''}`, a.title, a.date, 'Open')),
    ...(checkinDue ? [needsCard('health:checkin', "Today's check-in", today, 'Log it')] : []),
    ...habits.filter((h) => !h.doneToday).map((h) => needsCard(`health-habit:${h.name}`, h.name, today, 'Log it', 'Habit for today')),
  ];
  return all;
}

/** A module tour's three steps (8.0 section D): what it keeps, how it fills itself, and one record as it
 *  would look. The page shows them only when the person asks (ModuleTour's "Show me around"). */
export function tourSteps(module: { name: string; words: string; fills: string; example: { title: string; lines: string[] } }): { title: string; body: string; example?: { title: string; lines: string[] } }[] {
  return [
    { title: `What ${module.name} keeps`, body: module.words },
    { title: 'It fills itself', body: module.fills },
    { title: 'What a record looks like', body: '', example: module.example },
  ];
}
