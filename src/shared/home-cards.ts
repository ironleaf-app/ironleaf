// Home's cards (8.7 wave 1, item 3): what Change Home can pick, in the mock-ups' words, and the person's arrangement
// of them (which are on, in what order), kept per vault across restarts. Pack cards appear only while their pack is
// switched on. Pure: views/HomeView.tsx renders them, tests/home-87.test.mjs proves the arrangement.

export type HomeCardId =
  | 'due' | 'brief' | 'inbox' | 'day-note' | 'waiting' | 'recent' | 'upcoming' | 'activity'
  | 'bills' | 'habits' | 'weekly' | 'family';

export interface HomeCardDef {
  id: HomeCardId;
  /** The card's name in Change Home. */
  title: string;
  /** One line on what it does. */
  words: string;
  /** The pack (life module) it needs, if any. */
  pack?: { module: string; name: string };
}

export const HOME_CARDS: HomeCardDef[] = [
  { id: 'due', title: 'Today’s due items', words: 'Late, today and this week, ticked here.' },
  { id: 'brief', title: 'Morning brief', words: 'The few things worth knowing first.' },
  { id: 'inbox', title: 'Inbox', words: 'Captures waiting to be filed.' },
  { id: 'day-note', title: 'Day note', words: 'Today’s note, open for writing.' },
  { id: 'waiting', title: 'Waiting on others', words: 'Who owes what, and its chase.' },
  { id: 'recent', title: 'Recently viewed', words: 'Pages opened lately.' },
  { id: 'upcoming', title: 'Upcoming', words: 'Today’s meetings and near dates.' },
  { id: 'activity', title: 'Recent activity', words: 'What changed since yesterday.' },
  { id: 'bills', title: 'Bills due', words: 'Overdue and coming up, marked paid here.', pack: { module: 'finance', name: 'Money' } },
  { id: 'habits', title: 'Habits to tick', words: 'Yes or no for today.', pack: { module: 'health', name: 'Health' } },
  { id: 'weekly', title: 'Weekly update', words: 'This week’s update and when it is due.', pack: { module: 'weekly', name: 'Weekly' } },
  { id: 'family', title: 'Family today', words: 'Who’s where, birthdays, rewards.', pack: { module: 'family', name: 'Family' } },
];

export const HOME_CARD_IDS = HOME_CARDS.map((c) => c.id);

/** What a new Home shows, in the home mock-up's order (8.7 wave 1 polish, 30 Oct 2026: due items, recently
 *  viewed, upcoming, then the rest). */
export const DEFAULT_HOME_CARDS: HomeCardId[] = ['due', 'recent', 'upcoming', 'brief'];

/** The person's arrangement: the cards on, in order. Everything else is on offer in Change Home. */
export interface HomeLayout {
  on: HomeCardId[];
}

export function defaultHomeLayout(): HomeLayout {
  return { on: [...DEFAULT_HOME_CARDS] };
}

/** A saved arrangement read back: unknown cards dropped, repeats kept once, never empty (Home always shows Due). */
export function normalizeHomeLayout(raw: unknown): HomeLayout {
  const known = new Set<string>(HOME_CARD_IDS);
  const ids = raw && typeof raw === 'object' && Array.isArray((raw as HomeLayout).on) ? (raw as HomeLayout).on : [];
  const on = [...new Set(ids.filter((id): id is HomeCardId => typeof id === 'string' && known.has(id)))] as HomeCardId[];
  if (!on.length) on.push('due');
  return { on };
}

/** Cards not on, for Change Home's offer (pack cards carry their pack, so the dialog can say what unlocks them). */
export function homeOffers(on: HomeCardId[]): HomeCardDef[] {
  const showing = new Set(on);
  return HOME_CARDS.filter((c) => !showing.has(c.id));
}

/** A card moved within the arrangement (from its place to another). */
export function moveHomeCard(layout: HomeLayout, id: HomeCardId, to: number): HomeLayout {
  const on = layout.on.filter((c) => c !== id);
  on.splice(Math.max(0, Math.min(on.length, to)), 0, id);
  return normalizeHomeLayout({ on });
}

/** A card added to the end, or taken away (taking the last one away leaves Due: Home is never bare). */
export function setHomeCard(layout: HomeLayout, id: HomeCardId, show: boolean): HomeLayout {
  const on = show ? [...layout.on.filter((c) => c !== id), id] : layout.on.filter((c) => c !== id);
  return normalizeHomeLayout({ on });
}

/** The cards that are the one page itself (10.0: due items, the brief, waiting, upcoming, activity and the day note
 *  are core sections now, always in the page's order); the rest are extras below, in the person's order. */
export const CORE_HOME_CARDS: HomeCardId[] = ['due', 'brief', 'waiting', 'upcoming', 'activity', 'day-note'];
export const EXTRA_HOME_CARDS: HomeCardId[] = ['inbox', 'recent', 'bills', 'habits', 'weekly', 'family'];

/** An arrangement's extras: the cards that are not the page itself, in the person's order. */
export function extrasOf(on: HomeCardId[]): HomeCardId[] {
  const extra = new Set<string>(EXTRA_HOME_CARDS);
  return on.filter((id) => extra.has(id));
}
