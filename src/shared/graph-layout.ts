// The card map (29 Oct 2026, on the old circle graph): pure maths for the two card views that replaced the
// circles (components/GraphView.tsx). The Map is one column per area on a fixed grid, one card per project,
// busiest first, so nothing can overlap and every card is readable. The Focus view is the item as a large card
// with its neighbours in card columns around it. The data it groups with (focusGroups, the area and project
// clustering) lives in graph-scope.ts and is kept; everything that only served the circles (sectors, rings,
// packed circles, the camera) is gone.
import { FOCUS_GROUPS, focusGroupOf, focusGroups, graphAreaOf, isHiddenGraphNode, projectOfNode, topFolderOf, type FocusGroup, type FocusGroupId, type FocusNode } from './graph-scope';
import { isFinished } from './finished';
import { healthTone as sharedHealthTone, isOpenProject, projectStanding, type StandingWords } from './project-standing';
import { plainText } from './plain-text';
import { readDay as sharedReadDay, todayDay, utcDay } from './today-count';

/** The areas that lead the Map, in this order; any other area follows by name (ITEMS: Work, Business, Home, Me, then any other). */
export const AREA_ORDER: readonly string[] = ['Work', 'Business', 'Home', 'Me'];
/** Projects shown in an area column before "Show N more". */
export const MAP_SHOW = 8;
/** Cards shown in a Focus column before "Show N more". */
export const FOCUS_SHOW = 6;
/** Centres kept in the breadcrumb above the Focus view. */
export const HISTORY_MAX = 5;
/** Areas that never get a Map column: their notes are left out of the Map (ITEMS). */
const MAP_LEFT_OUT = new Set(['daily', 'templates']);

export type HealthTone = 'ok' | 'warn' | 'bad' | 'none';

/** A project's standing in the words every page uses (one fact, one value, 8 Nov 2026: the Graph reads what
 *  the Projects page reads — "Off track" for off track, never the old collapsed "At risk"). Finished, closed or
 *  on-hold projects read Finished, On hold or Idea, whatever their health still says; past its due day a live
 *  project is never "On track" (sweep 3, 063); what no list reads says "Active", never "On track". */
export function healthWord(health?: string, due?: string, today: number = todayDay(), status?: string): StandingWords {
  const day = due ? readDay(due) : null;
  return projectStanding({ status, health, overdue: day !== null && day < today }).words;
}
export function healthTone(health?: string): HealthTone {
  return sharedHealthTone(health);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** A day written in a note as a day number, or null. The one day reading Today uses, so the Graph presses on
 *  the same days Today presses on (a bare "tomorrow", month-first and slashes read; year-less reads nearest,
 *  never always this year). A date buried in longer words still reads through its ISO day. */
export function readDay(text?: string): number | null {
  const t = String(text ?? '').trim();
  if (!t) return null;
  const r = sharedReadDay(t, new Date());
  if (r) return utcDay(r.year, r.month, r.day);
  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (iso) {
    const buried = sharedReadDay(iso[0], new Date());
    if (buried) return utcDay(buried.year, buried.month, buried.day);
  }
  return null;
}
const dayText = (day: number): string => { const d = new Date(day * 86400000); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${d.getUTCFullYear() !== new Date().getFullYear() ? ` ${d.getUTCFullYear()}` : ''}`; };
/** A due day in words ("Due today", "Due in 3 days", "2 days overdue", "Due 14 Nov"), against `today` (a day number; the real today when left out). */
export function dueWords(due?: string, today: number = todayDay()): string | null {
  if (!due?.trim()) return null;
  const day = readDay(due);
  if (day === null) return `Due ${due.trim()}`;
  const n = day - today;
  if (n < 0) return `${-n === 1 ? '1 day' : `${-n} days`} overdue`;
  if (n === 0) return 'Due today';
  if (n <= 7) return `Due in ${n === 1 ? '1 day' : `${n} days`}`;
  return `Due ${dayText(day)}`;
}

/**
 * The neighbours a card counts and the Focus view shows, from one place (round 2, 29 Oct 2026: the Map said
 * 0 people while the Focus view of the same project found 11, because the counts only looked in the project's
 * folder and the Focus view follows links): the Focus groups (everything within two levels, by link) plus,
 * for a project, the notes that are its own (its folder, its `owner`, an "owns" link) even when nothing links
 * to them yet. Both the Map's counts and the Focus columns read this, so they can never disagree again.
 */
export function cardNeighbours(nodes: readonly FocusNode[], links: readonly { source: string; target: string }[], centreId: string, opts: { ownNames?: readonly string[]; only?: readonly FocusGroupId[]; showHidden?: boolean } = {}): FocusGroup[] {
  const groups = focusGroups(nodes, links, centreId, opts);
  const centre = nodes.find((n) => n.id === centreId);
  if (!centre?.project) return groups;
  const own = new Set((opts.ownNames ?? []).map((n) => n.trim().toLowerCase()).filter(Boolean));
  const byId = new Map(groups.map((g) => [g.id, g]));
  const have = new Set(groups.flatMap((g) => g.nodes.map((n) => n.id)));
  for (const n of nodes) {
    if (n.id === centreId || have.has(n.id) || (n.kind !== 'note' && n.kind !== 'file')) continue;
    if (!opts.showHidden && isHiddenGraphNode(n)) continue;
    if (own.has(n.title.trim().toLowerCase())) continue;
    if (projectOfNode(n, nodes, links)?.id !== centreId) continue;
    const g = focusGroupOf(n);
    if (opts.only?.length && !opts.only.includes(g) && !(g === 'decisions' && opts.only.includes('notes'))) continue;
    const had = byId.get(g);
    if (had) had.nodes.push({ ...n, depth: 1 });
    else { const made: FocusGroup = { id: g, label: FOCUS_GROUPS.find((x) => x.id === g)?.label ?? 'Notes', nodes: [{ ...n, depth: 1 }] }; byId.set(g, made); groups.push(made); }
    have.add(n.id);
  }
  for (const g of groups) g.nodes.sort((a, b) => a.depth - b.depth || a.title.localeCompare(b.title));
  return groups;
}

/** The three small counts on a project card: its people, meetings and notes, from the same neighbours the Focus view shows. */
export interface ProjectCounts { people: number; meetings: number; notes: number; total: number }
export function projectCounts(projectId: string, nodes: readonly FocusNode[], links: readonly { source: string; target: string }[] = [], opts: { ownNames?: readonly string[]; showHidden?: boolean } = {}): ProjectCounts {
  const counts: ProjectCounts = { people: 0, meetings: 0, notes: 0, total: 0 };
  // The project's own: direct neighbours only (8.0, 29 Oct 2026: two levels out, most Work projects showed the same
  // 11 people, 2 meetings and 18 notes). The Focus view still shows the second level, marked as such.
  for (const g of cardNeighbours(nodes, links, projectId, opts)) {
    const own = g.nodes.filter((n) => !('depth' in n) || (n as { depth?: number }).depth !== 2).length;
    if (g.id === 'people') counts.people += own;
    else if (g.id === 'meetings') counts.meetings += own;
    else if (g.id === 'notes' || g.id === 'decisions') counts.notes += own;
    counts.total += own;
  }
  return counts;
}

export interface MapProject extends FocusNode { counts: ProjectCounts; healthWord: StandingWords; tone: HealthTone; dueWords: string | null }
export interface MapColumn { area: string; projects: MapProject[]; loose: number; finished: number; held: number; closed: number; counts: { projects: number; people: number; meetings: number; notes: number } }

/** An area's closed projects in words ("2 finished · 1 on hold"), for the column's quiet line under the cards. */
export function closedWords(col: Pick<MapColumn, 'finished' | 'held'>): string {
  const bits: string[] = [];
  if (col.finished > 0) bits.push(`${col.finished} finished`);
  if (col.held > 0) bits.push(`${col.held} on hold`);
  return bits.join(' · ');
}

/** The column for projects that sit in no area folder (round 2: never "Notes at the top"). */
export const NO_AREA = 'Not in an area';
const areaOfProject = (id: string): string => { const a = graphAreaOf(id); return a === 'Notes at the top' ? NO_AREA : a; };

/**
 * The whole vault as the Map (ITEMS; round 2, 29 Oct 2026): one column per area that holds at least one
 * project (Work, Business, Home, Me, then any other by name; a folder with no projects in it, Publications,
 * Views or any other, is never a column), each holding one card per project in it, busiest first (most
 * neighbours, then most links, then its name). Projects in no area folder sit in "Not in an area", last.
 * Daily and Templates stay out. An area's loose notes (in no project) are counted, not carded, and only
 * inside a column that already has projects: the column's quiet "N other notes" card. Finished, closed and
 * on-hold projects hold no card either — like the Projects page they are counted apart (the column's quiet
 * "N finished · M on hold" line), so the Map's counts are the page's open counts.
 */
export function buildMap(nodes: readonly FocusNode[], links: readonly { source: string; target: string; kind?: string; kinds?: readonly string[] }[] = [], today?: number): MapColumn[] {
  const degree = new Map<string, number>();
  for (const l of links) { degree.set(l.source, (degree.get(l.source) ?? 0) + 1); degree.set(l.target, (degree.get(l.target) ?? 0) + 1); }
  const byArea = new Map<string, MapProject[]>();
  const loose = new Map<string, number>();
  const finished = new Map<string, number>();
  const held = new Map<string, number>();
  for (const n of nodes) {
    if (n.kind !== 'note' && n.kind !== 'file') continue;
    if (isHiddenGraphNode(n)) continue;
    if (MAP_LEFT_OUT.has(graphAreaOf(n.id).toLowerCase())) continue;
    if (n.project) {
      const area = areaOfProject(n.id);
      if (!isOpenProject(n.status)) {
        const into = isFinished(n.status) ? finished : held;
        into.set(area, (into.get(area) ?? 0) + 1);
        continue;
      }
      const counts = projectCounts(n.id, nodes, links);
      const day = n.due ? readDay(n.due) : null;
      const standing = projectStanding({ status: n.status, health: n.health, overdue: day !== null && day < (today ?? todayDay()) });
      byArea.set(area, [...(byArea.get(area) ?? []), { ...n, counts, healthWord: standing.words, tone: standing.tone, dueWords: dueWords(n.due, today) }]);
    } else if (!projectOfNode(n, nodes, links)) loose.set(areaOfProject(n.id), (loose.get(areaOfProject(n.id)) ?? 0) + 1);
  }
  // An area holding only closed projects still holds a column, so its quiet "N finished" line shows.
  for (const area of [...finished.keys(), ...held.keys()]) if (!byArea.has(area)) byArea.set(area, []);
  const rank = (a: MapProject, b: MapProject) => b.counts.total - a.counts.total || (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) || a.title.localeCompare(b.title);
  const order = (a: string, b: string) => { if (a === NO_AREA) return 1; if (b === NO_AREA) return -1; const [ia, ib] = [AREA_ORDER.indexOf(a), AREA_ORDER.indexOf(b)]; return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b); };
  return [...byArea.keys()].sort(order).map((area) => {
    const projects = (byArea.get(area) ?? []).sort(rank);
    const doneCount = finished.get(area) ?? 0;
    const heldCount = held.get(area) ?? 0;
    return { area, projects, loose: loose.get(area) ?? 0, finished: doneCount, held: heldCount, closed: doneCount + heldCount, counts: { projects: projects.length, people: projects.reduce((n, p) => n + p.counts.people, 0), meetings: projects.reduce((n, p) => n + p.counts.meetings, 0), notes: projects.reduce((n, p) => n + p.counts.notes, 0) + (loose.get(area) ?? 0) } };
  });
}

export interface LinkMapNote extends FocusNode { links: number }
export interface LinkMapColumn { folder: string; notes: LinkMapNote[]; count: number }

/** The column for notes at the vault's top (the link map groups by folder, not area). */
export const NO_FOLDER = 'Top level';

/**
 * The whole vault as a link map (5 Nov 2026, u3 moving-in): for a vault with nothing project-shaped, where the
 * project Map would be one dead "N other notes" line. One column per top folder, busiest first; one card per
 * note in it, busiest first (most links, then its name). Daily and Templates stay out, as the Map.
 */
export function buildLinkMap(nodes: readonly FocusNode[], links: readonly { source: string; target: string }[] = []): LinkMapColumn[] {
  const degree = new Map<string, number>();
  for (const l of links) { degree.set(l.source, (degree.get(l.source) ?? 0) + 1); degree.set(l.target, (degree.get(l.target) ?? 0) + 1); }
  const byFolder = new Map<string, LinkMapNote[]>();
  for (const n of nodes) {
    if (n.kind !== 'note' && n.kind !== 'file') continue;
    if (isHiddenGraphNode(n)) continue;
    if (MAP_LEFT_OUT.has(graphAreaOf(n.id).toLowerCase())) continue;
    const top = topFolderOf(n.id);
    const folder = top || NO_FOLDER;
    byFolder.set(folder, [...(byFolder.get(folder) ?? []), { ...n, links: degree.get(n.id) ?? 0 }]);
  }
  const busy = (list: LinkMapNote[]) => list.reduce((t, n) => t + n.links, 0);
  return [...byFolder.entries()]
    .sort((a, b) => busy(b[1]) - busy(a[1]) || a[0].localeCompare(b[0]))
    .map(([folder, notes]) => ({ folder, notes: notes.sort((a, b) => b.links - a.links || a.title.localeCompare(b.title)), count: notes.length }));
}

/** What one note links to and what links to it, either direction, each once, never itself (the link map's hover lines). */
export function linkNeighbours(id: string, links: readonly { source: string; target: string }[]): string[] {
  const out = new Set<string>();
  for (const l of links) {
    if (l.source === id && l.target !== id) out.add(l.target);
    else if (l.target === id && l.source !== id) out.add(l.source);
  }
  return [...out];
}

/** The names in one "Both have …" reason ("Both have Ana Lee and Ben Fox" → both names; "… and 2 others" is not a name). */
export function sharedPeopleIn(reason: string): string[] {
  const m = /^Both have\s+(.+)$/i.exec(reason.trim());
  if (!m) return [];
  return m[1].replace(/\s+and\s+\d+\s+others?$/i, '').split(/\s*(?:,|\s+and\s+)\s*/).map((x) => x.trim()).filter((x) => x && !/^\d+\s+others?$/i.test(x));
}

export interface SharedLink { a: string; b: string; people: string[]; reasons: string[]; linked: boolean }
/**
 * Which projects share people or a link (ITEMS: the Map's hover lines): a pair counts when a person belongs
 * to both (through a People note each links to, or a "Both have …" reason on their own link), or when the two
 * projects link to each other in either direction. The same either way round: looking a pair up from A or
 * from B gives the same shared names, sorted, with no pair repeated.
 */
export function sharedProjectLinks(nodes: readonly FocusNode[], links: readonly { source: string; target: string; kind?: string; kinds?: readonly string[]; reasons?: readonly string[] }[]): SharedLink[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const projects = new Set(nodes.filter((n) => n.project).map((n) => n.id));
  const pairs = new Map<string, SharedLink>();
  const pair = (a: string, b: string): SharedLink => { const [x, y] = a < b ? [a, b] : [b, a]; const had = pairs.get(`${x}\0${y}`); if (had) return had; const made: SharedLink = { a: x, b: y, people: [], reasons: [], linked: false }; pairs.set(`${x}\0${y}`, made); return made; };
  const addPeople = (a: string, b: string, names: string[]) => { const p = pair(a, b); for (const name of names) if (name && !p.people.includes(name)) p.people.push(name); };
  // A person who belongs to two projects joins them (the person note's own links, either direction).
  const ofPerson = new Map<string, Set<string>>();
  for (const l of links) {
    const [a, b] = [byId.get(l.source), byId.get(l.target)];
    if (!a || !b) continue;
    for (const [person, project] of [[a, b], [b, a]] as const) if (focusGroupOf(person) === 'people' && project.project) (ofPerson.get(person.id) ?? ofPerson.set(person.id, new Set()).get(person.id)!).add(project.id);
    if (a.project && b.project) {
      const p = pair(a.id, b.id);
      const kinds = l.kinds ?? (l.kind ? [l.kind] : []);
      for (const r of l.reasons ?? []) { if (!p.reasons.includes(r)) p.reasons.push(r); addPeople(a.id, b.id, sharedPeopleIn(r)); }
      if (kinds.some((k) => k === 'link' || k === 'mentions' || k === 'paired' || k === 'people')) p.linked = true;
    }
  }
  for (const [personId, set] of ofPerson) { const ps = [...set].sort(); const name = byId.get(personId)?.title ?? ''; for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) addPeople(ps[i], ps[j], [name]); }
  return [...pairs.values()].filter((p) => projects.has(p.a) && projects.has(p.b) && (p.people.length || p.linked)).map((p) => ({ ...p, people: [...p.people].sort((a, b) => a.localeCompare(b)) })).sort((a, b) => a.a.localeCompare(b.a) || a.b.localeCompare(b.b));
}
/** The projects one project shares people or a link with, and the shared names for each (both ways: symmetric). */
export function sharedWith(id: string, all: readonly SharedLink[]): { id: string; people: string[]; reasons: string[] }[] {
  const out: { id: string; people: string[]; reasons: string[] }[] = [];
  for (const p of all) { if (p.a === id) out.push({ id: p.b, people: p.people, reasons: p.reasons }); else if (p.b === id) out.push({ id: p.a, people: p.people, reasons: p.reasons }); }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/** What kind of thing a card is, in one plain word. */
export function kindWord(node: FocusNode): string {
  if (node.kind === 'file') return 'File';
  if (node.project) return 'Project';
  const g = focusGroupOf(node);
  return g === 'people' ? 'Person' : g === 'meetings' ? 'Meeting' : g === 'decisions' ? 'Decision' : g === 'projects' ? 'Project' : node.doc ? 'Doc' : 'Note';
}
/** A card's one detail line: a project's health and due, a person's role and organisation, a meeting's day, else its summary or where it sits. Summary words are plain (round 2): no marks, comments or raw links. */
export function cardDetail(node: FocusNode, today?: number): string {
  const g = focusGroupOf(node);
  const summary = node.summary ? plainText(node.summary) : '';
  if (node.project) {
    const day = node.due ? readDay(node.due) : null;
    const standing = projectStanding({ status: node.status, health: node.health, overdue: day !== null && day < (today ?? todayDay()) });
    // Finished, closed and on-hold projects read their standing with no due pressure; an overdue one reads its
    // due day, which already says it ("39 days overdue", never "Overdue · 39 days overdue").
    if (!standing.open) return standing.words;
    if (standing.words === 'Overdue') return dueWords(node.due, today) ?? 'Overdue';
    return [standing.words, dueWords(node.due, today)].filter(Boolean).join(' · ') || summary || 'Project';
  }
  if (g === 'people') return [node.role, node.org].filter(Boolean).join(' · ') || summary || 'Person';
  if (g === 'meetings') { const day = readDay(node.date ?? node.id); return node.date || (day !== null ? dayText(day) : '') || summary || 'Meeting'; }
  return summary || (node.id.includes('/') ? node.id.slice(0, node.id.lastIndexOf('/')) : 'Note');
}

/** The Focus columns in the order the page shows them (ITEMS): People, Meetings, Notes, Decisions, Files, Related projects. */
export const FOCUS_ORDER: readonly FocusGroupId[] = ['people', 'meetings', 'notes', 'decisions', 'files', 'projects'];
export interface FocusColumn extends FocusGroup { visible: (FocusNode & { depth: 1 | 2 })[]; more: number }
/**
 * The Focus view's columns (ITEMS): an item's neighbours (focusGroups, two levels, the person's own node never
 * a hub) grouped People, Meetings (upcoming first, then past, then undated), Notes, Decisions, Files and
 * Related projects, only the groups that have something, each cut at FOCUS_SHOW with the rest counted in `more`.
 */
export function focusColumns(nodes: readonly FocusNode[], links: readonly { source: string; target: string }[], centreId: string, opts: { ownNames?: readonly string[]; only?: readonly FocusGroupId[]; showHidden?: boolean; today?: number } = {}): FocusColumn[] {
  const today = opts.today ?? todayDay();
  const meetingRank = (n: FocusNode) => { const day = readDay(n.date ?? n.id); return day === null ? 2 : day >= today ? 0 : 1; };
  return FOCUS_ORDER.map((id) => cardNeighbours(nodes, links, centreId, opts).find((g) => g.id === id)).filter((g): g is FocusGroup => !!g).map((g) => {
    const sorted = g.id !== 'meetings' ? g.nodes : [...g.nodes].sort((a, b) => {
      const [ra, rb] = [meetingRank(a), meetingRank(b)];
      if (ra !== rb) return ra - rb;
      const [da, db] = [readDay(a.date ?? a.id), readDay(b.date ?? b.id)];
      if (da !== null && db !== null && da !== db) return ra === 1 ? db - da : da - db;
      return a.title.localeCompare(b.title);
    });
    return { ...g, nodes: sorted, visible: sorted.slice(0, FOCUS_SHOW), more: Math.max(0, sorted.length - FOCUS_SHOW) };
  });
}

/** A thin curved line between two cards (ITEMS: SVG, 1.5px): out of one card's facing edge, into the other's, bending halfway. */
export function cardLinkPath(from: { x: number; y: number; w: number; h: number }, to: { x: number; y: number; w: number; h: number }): string {
  const r = (n: number) => Math.round(n * 10) / 10;
  // Two cards in the same column (8.0, 29 Oct 2026: lines looped out over the cards to the page's left edge): right edge
  // to right edge, bulging out to the right by how far apart they are.
  if (Math.abs(to.x + to.w / 2 - (from.x + from.w / 2)) < Math.min(from.w, to.w) / 2) {
    const xa = from.x + from.w, ya = from.y + from.h / 2, xb = to.x + to.w, yb = to.y + to.h / 2;
    const out = Math.min(90, 18 + Math.abs(yb - ya) / 4);
    return `M ${r(xa)} ${r(ya)} C ${r(xa + out)} ${r(ya)}, ${r(xb + out)} ${r(yb)}, ${r(xb)} ${r(yb)}`;
  }
  const right = to.x + to.w / 2 >= from.x + from.w / 2;
  const x1 = from.x + (right ? from.w : 0); const y1 = from.y + from.h / 2;
  const x2 = to.x + (right ? 0 : to.w); const y2 = to.y + to.h / 2;
  const bend = Math.max(32, Math.abs(x2 - x1) / 2);
  return `M ${r(x1)} ${r(y1)} C ${r(x1 + (right ? bend : -bend))} ${r(y1)}, ${r(x2 - (right ? bend : -bend))} ${r(y2)}, ${r(x2)} ${r(y2)}`;
}

/** Whether a card's rectangle shows inside the view's rectangle at all (round 2: hover lines only to cards on screen). */
export function rectVisible(r: { x: number; y: number; w: number; h: number }, view: { x: number; y: number; w: number; h: number }): boolean {
  return r.x < view.x + view.w && r.x + r.w > view.x && r.y < view.y + view.h && r.y + r.h > view.y;
}

/** The breadcrumb of centres (last HISTORY_MAX): a new centre is added once; going back drops the ones after it. */
export function pushCentre(history: readonly string[], id: string, max = HISTORY_MAX): string[] {
  if (history[history.length - 1] === id) return [...history];
  const at = history.indexOf(id);
  if (at >= 0) return history.slice(0, at + 1);
  return [...history, id].slice(-max);
}
export const groupOfNode = focusGroupOf;
