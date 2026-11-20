// The move into areas of life (Wave 4, 24 Oct 2026; src/shared/areas.ts)., and the rule "every fact kept and checked".
// This works out the proposal the migration assistant shows: for each thing that would move (a project with its whole
// folder, a note, a file), the area it belongs in, how sure that is and why, in plain words, and where it would go.
// Nothing is decided by topic words written into Ironleaf: only by what the vault itself says —
//  sure    an `area:` property; already in an area's folder; a template or the asset store (the quiet area, which
//           stay where they are); a tag that is an area's name ("#work", "personal")
//   likely  what it is joined to: the projects a person is named in, the project a meeting or note belongs to, the
//           notes a file is linked from, the notes it links to; projects whose folders on the PC sit together; the tags
//           it shares with things already placed; a project's kind of layout (a habit or fitness plan, a venture)
//   guess   only the area's own words (its name and "what it holds", which the person can change) in its name or tags
//   none    nothing says: left where it is unless the person chooses an area in the preview
//Each thing's new place keeps its path under the area's folder ("Docs/Siteplan.md" → "Work/Docs/Siteplan.md", a project's
// folder "Projects/Tessaly" → "Work/Projects/Tessaly"); loose files from the attachments folder go in the area's Files.
// The main side (src/main/life.ts) applies it with the app's own move (every link brought up to date), checks every link
// still reaches the same thing afterwards, and keeps a safety copy. Pure: no files, no Node.

import { areaNamed, areaOfFolder, areaWords, KIND_FOLDERS, type Area, type AreaPlaces } from './areas';
import { isProjectProps } from './project-file';

export type Sure = 'sure' | 'likely' | 'guess' | 'none';
export const SURE_WORDS: Record<Sure, string> = { sure: 'Sure', likely: 'Likely', guess: 'A guess', none: 'Not sure' };

export interface MigrationNote {
  path: string;
  props: Record<string, unknown>;
  tags: string[];
  /** The notes and files its links reach (already resolved). */
  links: string[];
}

export interface MigrationInput {
  notes: MigrationNote[];
  /** Every file that isn't a note (pictures, PDFs, documents, canvases). */
  files: string[];
  areas: Area[];
  places: AreaPlaces & { attachmentsFolder?: string; dailyFolder?: string };
  /** Other joins the connected vault knows (a person and the projects they are named in): path → paths. */
  joins?: Map<string, string[]>;
  /** What reading each thing says (the assistant read its opening lines beside each area's own words; src/main/life.ts):
   *  unit path → the area and why. Counts as much as a link to something already placed, never over a tag or `area:`. */
  readings?: Map<string, { area: string; why: string }>;
}

export interface UnitPlan {
  /** What moves: a project's folder (`folder`), or one note or file. */
  path: string;
  folder: boolean;
  kind: 'project' | 'person' | 'meeting' | 'doc' | 'note' | 'file';
  title: string;
  /** How many files move with it (a project's folder). */
  files: number;
  /** The area proposed (undefined: none). */
  area?: string;
  sure: Sure;
  /** Why, in plain words ("Tagged work", "Named in 4 Work projects"). */
  why: string[];
  /** Its place in the area (with `area`). */
  to?: string;
}

export interface Stay {
  path: string;
  why: string;
}

export interface MigrationPlan {
  units: UnitPlan[];
  /** Folders and things that stay where they are, and why (templates, the asset store, daily notes, the Inbox). */
  stays: Stay[];
  /** How many things each area would get. */
  counts: Record<string, number>;
  /** Every path there was when it was worked out (so a choice never lands on one). */
  paths?: string[];
}

const cleanDir = (d: string | undefined) => (d ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
const folderOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const baseOf = (p: string) => p.split('/').pop() ?? p;
const titleOf = (p: string) => baseOf(p).replace(/\.(md|canvas)$/i, '');
const under = (p: string, dir: string) => !!dir && (p.toLowerCase() === dir.toLowerCase() || p.toLowerCase().startsWith(`${dir.toLowerCase()}/`));
const STOP = new Set('a an and are as at be by for from has have in into is it its of on or our the their them they this to was were what when where which who will with your you'.split(' '));

/** A project's layout that says which kind of life it is about (the layouts Ironleaf makes projects with). */
// A hint only (26 Oct 2026: a home Minecraft server set up with the venture layout went to Business on that alone): a
// layout is how a project is drawn, not what it is about. "venture" is used for anything with stages, so it says nothing.
const LAYOUT_AREA: Record<string, string> = { fitness: 'health', wellbeing: 'health', habit: 'health' };

function wordsOf(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length > 2 && !STOP.has(w));
}

/** The area's own words for a guess: its name, folder and "what it holds", each word once. */
function guessWords(a: Area): Set<string> {
  return new Set([...areaWords(a), ...wordsOf(a.about).filter((w) => w.length > 3)].map((w) => w.toLowerCase()));
}

export function planMigration(input: MigrationInput): MigrationPlan {
  const { areas, places } = input;
  const templates = cleanDir(places.templatesFolder);
  const assets = cleanDir(places.assetsFolder);
  const daily = cleanDir(places.dailyFolder);
  const attachments = cleanDir(places.attachmentsFolder);
  const stays: Stay[] = [];
  const stayed = new Set<string>();
  const stay = (path: string, why: string) => {
    if (stayed.has(path)) return;
    stayed.add(path);
    stays.push({ path, why });
  };
  const byPath = new Map(input.notes.map((n) => [n.path, n]));
  const all = [...input.notes.map((n) => n.path), ...input.files];

  // 1. What moves as one: each project with its folder (when the folder is the project's own), else each note and file.
  const projectFiles = input.notes.filter((n) => isProjectProps(n.props));
  const projectDir = new Map<string, string>(); // folder → project file
  for (const p of projectFiles.sort((a, b) => a.path.length - b.path.length)) {
    const dir = folderOf(p.path);
    if (!dir || areaOfFolder(p.path, areas)) continue;
    // A folder holding several projects (or a top folder such as Projects itself) isn't one project's own.
    const siblings = projectFiles.filter((q) => folderOf(q.path) === dir);
    if (siblings.length > 1 || !dir.includes('/')) continue;
    if ([...projectDir.keys()].some((d) => under(dir, d))) continue; // inside another project's folder: moves with it
    projectDir.set(dir, p.path);
  }
  const unitOf = new Map<string, string>(); // any path → its unit's path
  const units = new Map<string, UnitPlan>();
  for (const [dir, file] of projectDir) {
    const n = byPath.get(file)!;
    const count = all.filter((p) => under(p, dir)).length;
    units.set(dir, { path: dir, folder: true, kind: 'project', title: String(n.props.name ?? titleOf(file)), files: count, sure: 'none', why: [] });
    for (const p of all) if (under(p, dir)) unitOf.set(p, dir);
  }
  for (const p of all) {
    if (unitOf.has(p)) continue;
    if (/^\.|\/\./.test(p)) continue;
    if (areaOfFolder(p, areas)) continue; // already in an area
    if (under(p, templates)) {
      stay(templates, 'Templates stay where they are; they are the Library’s, kept out of Today and search');
      continue;
    }
    if (under(p, assets)) {
      stay(assets, 'The asset store stays where it is (its brand kit and tags go with it); it is the Library’s');
      continue;
    }
    if (under(p, daily)) {
      stay(daily, 'Daily notes stay together: a day can hold every area');
      continue;
    }
    if (/^inbox(\.md)?$/i.test(p) || /^inbox\//i.test(p)) {
      stay(p.toLowerCase().startsWith('inbox/') ? 'Inbox' : p, 'The Inbox stays at the top: it is where new things wait to be filed');
      continue;
    }
    if (/^private notes\//i.test(p)) continue;
    const n = byPath.get(p);
    const type = String(n?.props?.type ?? '').toLowerCase();
    const kind: UnitPlan['kind'] = !n ? 'file' : type === 'person' || /^(people|contacts)\//i.test(p) ? 'person' : type === 'meeting' ? 'meeting' : type === 'doc' ? 'doc' : 'note';
    units.set(p, { path: p, folder: false, kind, title: n ? titleOf(p) : baseOf(p), files: 1, sure: 'none', why: [] });
    unitOf.set(p, p);
  }

  // 2. The joins between units: links either way, the connected vault's joins, a canvas and the doc of its name.
  const near = new Map<string, Map<string, string>>(); // unit → neighbour unit → how
  const join = (a: string | undefined, b: string | undefined, how: string, back: string) => {
    if (!a || !b || a === b) return;
    if (!near.has(a)) near.set(a, new Map());
    if (!near.has(b)) near.set(b, new Map());
    if (!near.get(a)!.has(b)) near.get(a)!.set(b, how);
    if (!near.get(b)!.has(a)) near.get(b)!.set(a, back);
  };
  const fixed = new Map<string, string>(); // a path already in an area (or quiet) → its area id
  const fixedOf = (p: string): string | undefined => {
    if (fixed.has(p)) return fixed.get(p);
    const a = areaOfFolder(p, areas);
    if (a) fixed.set(p, a.id);
    return a?.id;
  };
  for (const n of input.notes) {
    for (const t of n.links) {
      const a = unitOf.get(n.path) ?? n.path;
      const b = unitOf.get(t) ?? t;
      join(a, b, 'Links to', 'Linked from');
    }
  }
  for (const [from, list] of input.joins ?? []) for (const to of list) join(unitOf.get(from) ?? from, unitOf.get(to) ?? to, 'Named in', 'Names');
  for (const u of units.values()) {
    if (!/\.canvas$/i.test(u.path)) continue;
    const doc = u.path.replace(/\.canvas$/i, '.md');
    if (units.has(doc)) join(u.path, doc, 'The canvas of', 'Its canvas');
  }
  // A note with a project's name is about that project ("Docs/Minecraft server" and the Minecraft server project).
  const projectByName = new Map([...projectDir].map(([dir, file]) => [titleOf(file).toLowerCase(), dir]));
  for (const u of units.values()) {
    if (u.folder || !/\.md$/i.test(u.path)) continue;
    const dir = projectByName.get(titleOf(u.path).toLowerCase());
    if (dir) join(u.path, dir, 'Has the name of', 'Has its name');
  }

  // 3. What each unit says about itself.
  const votes = new Map<string, Map<string, { score: number; why: string[] }>>();
  const vote = (unit: string, area: string | undefined, score: number, why: string) => {
    if (!area) return;
    const m = votes.get(unit) ?? new Map();
    const v = m.get(area) ?? { score: 0, why: [] };
    v.score += score;
    if (!v.why.includes(why)) v.why.push(why);
    m.set(area, v);
    votes.set(unit, m);
  };
  const decided = new Map<string, { area: string; sure: Sure; why: string[] }>();
  const nameOf = (id: string) => areas.find((a) => a.id === id)?.name ?? id;
  const tagArea = (tag: string) => {
    const t = tag.replace(/^#/, '').toLowerCase();
    return areas.find((a) => a.name.toLowerCase() === t || a.id === t || a.folder.toLowerCase() === t) ?? areas.find((a) => areaWords(a).includes(t));
  };
  for (const u of units.values()) {
    const file = u.kind === 'project' ? projectDir.get(u.path)! : u.path;
    const n = byPath.get(file);
    if (n?.props?.area !== undefined) {
      const a = areaNamed(n.props.area, areas);
      if (a) {
        decided.set(u.path, { area: a.id, sure: 'sure', why: [`Its area says ${a.name}`] });
        continue;
      }
    }
    const tagged = [...new Set((n?.tags ?? []).map(tagArea).filter((a): a is Area => !!a && !a.quiet))];
    if (tagged.length === 1) {
      decided.set(u.path, { area: tagged[0].id, sure: 'sure', why: [`Tagged ${(n?.tags ?? []).find((t) => tagArea(t)?.id === tagged[0].id)}`] });
      continue;
    }
    for (const a of tagged) vote(u.path, a.id, 3, `Tagged ${(n?.tags ?? []).find((t) => tagArea(t)?.id === a.id)}`);
    const layout = String(n?.props?.layout ?? '').toLowerCase();
    if (LAYOUT_AREA[layout] && areas.some((a) => a.id === LAYOUT_AREA[layout])) vote(u.path, LAYOUT_AREA[layout], 2, `A ${layout} project`);
    const read = input.readings?.get(u.path);
    if (read && areas.some((a) => a.id === read.area && !a.quiet)) vote(u.path, read.area, 5, read.why);
  }

  // Projects whose folders on the PC sit side by side are one part of life (the work projects all sit in one folder
  // on their PC, with the hub project as that folder itself).
  const pcParent = (p: string) => {
    const f = String(byPath.get(projectDir.get(p) ?? '')?.props?.folder ?? '').replace(/\\/g, '/').replace(/\/+$/, '');
    return f || undefined;
  };
  const pcGroups = new Map<string, string[]>();
  for (const u of units.values()) {
    if (u.kind !== 'project') continue;
    const f = pcParent(u.path);
    if (!f) continue;
    for (const key of [f, folderOf(f)]) {
      if (!key || !key.includes('/')) continue;
      const g = pcGroups.get(key.toLowerCase()) ?? [];
      g.push(u.path);
      pcGroups.set(key.toLowerCase(), g);
    }
  }

  // 4. Joins and shared tags vote, a few rounds, so what is placed places its neighbours (a project its people, a
  //    person their meetings, a note its files).
  const areaNow = (p: string): string | undefined => decided.get(p)?.area ?? fixedOf(p);
  const tagIndex = new Map<string, Set<string>>();
  for (const u of units.values()) {
    const file = u.kind === 'project' ? projectDir.get(u.path)! : u.path;
    for (const t of byPath.get(file)?.tags ?? []) {
      const k = t.toLowerCase();
      if (!tagIndex.has(k)) tagIndex.set(k, new Set());
      tagIndex.get(k)!.add(u.path);
    }
  }
  const settle = () => {
    for (const u of units.values()) {
      if (decided.get(u.path)?.sure === 'sure') continue;
      const own = votes.get(u.path);
      const round = new Map<string, { score: number; why: string[] }>();
      for (const [a, v] of own ?? []) round.set(a, { score: v.score, why: [...v.why] });
      const add = (a: string | undefined, s: number, why: string) => {
        if (!a || areas.find((x) => x.id === a)?.quiet) return;
        const v = round.get(a) ?? { score: 0, why: [] };
        v.score += s;
        if (!v.why.includes(why)) v.why.push(why);
        round.set(a, v);
      };
      // Joined things already placed.
      const counts = new Map<string, { n: number; how: Map<string, number> }>();
      for (const [other, how] of near.get(u.path) ?? []) {
        const a = areaNow(other);
        if (!a) continue;
        const c = counts.get(a) ?? { n: 0, how: new Map() };
        c.n++;
        c.how.set(how, (c.how.get(how) ?? 0) + 1);
        counts.set(a, c);
      }
      for (const [a, c] of counts) {
        const [how, n] = [...c.how].sort((x, y) => y[1] - x[1])[0];
        const one = n === 1 && c.n === 1 ? [...(near.get(u.path) ?? [])].find(([o]) => areaNow(o) === a)?.[0] : undefined;
        const single = one ? (units.get(one)?.title ?? titleOf(one)) : undefined;
        const counted = c.how.size === 1 && /^(Links to|Linked from|Named in|Names)$/.test(how) ? `${how} ${c.n} ${nameOf(a)} ${c.n === 1 ? 'thing' : 'things'}` : `Joined to ${c.n} ${nameOf(a)} ${c.n === 1 ? 'thing' : 'things'}`;
        add(a, Math.min(6, 2 * c.n), single ? `${how} ${single} (${nameOf(a)})` : counted);
      }
      // Projects in one folder on the PC.
      if (u.kind === 'project') {
        const f = pcParent(u.path);
        for (const key of f ? [f, folderOf(f)] : []) {
          const group = pcGroups.get(key.toLowerCase()) ?? [];
          const placed = group.filter((p) => p !== u.path && areaNow(p));
          if (!placed.length) continue;
          const tally = new Map<string, number>();
          for (const p of placed) tally.set(areaNow(p)!, (tally.get(areaNow(p)!) ?? 0) + 1);
          const [a, n] = [...tally].sort((x, y) => y[1] - x[1])[0];
          add(a, 3 + Math.min(3, n), `Its folder on the PC sits with ${n} ${nameOf(a)} ${n === 1 ? 'project' : 'projects'}`);
          break;
        }
      }
      // Tags shared with things placed (a tag most of whose things are in one area).
      const file = u.kind === 'project' ? projectDir.get(u.path)! : u.path;
      for (const t of byPath.get(file)?.tags ?? []) {
        const others = [...(tagIndex.get(t.toLowerCase()) ?? [])].filter((p) => p !== u.path && areaNow(p));
        if (others.length < 1) continue;
        const tally = new Map<string, number>();
        for (const p of others) tally.set(areaNow(p)!, (tally.get(areaNow(p)!) ?? 0) + 1);
        const [[a, n], second] = [...tally].sort((x, y) => y[1] - x[1]);
        if (second && second[1] >= n) continue;
        add(a, 1, `Shares the tag ${t} with ${nameOf(a)}`);
      }
      const best = [...round].sort((x, y) => y[1].score - x[1].score);
      if (!best.length) continue;
      const [a, v] = best[0];
      const margin = v.score - (best[1]?.[1].score ?? 0);
      if (v.score >= 3 && margin >= 2) decided.set(u.path, { area: a, sure: 'likely', why: v.why.slice(0, 3) });
      else if (decided.get(u.path)?.sure !== 'likely' && margin > 0) decided.set(u.path, { area: a, sure: 'guess', why: v.why.slice(0, 3) });
    }
  };
  for (let i = 0; i < 4; i++) settle();

  // 5. Still nothing: the area's own words in its name, tags or what it says it is about.
  for (const u of units.values()) {
    if (decided.has(u.path)) continue;
    const file = u.kind === 'project' ? projectDir.get(u.path)! : u.path;
    const n = byPath.get(file);
    const words = new Set(wordsOf([u.title, ...(n?.tags ?? []), String(n?.props?.about ?? ''), String(n?.props?.description ?? '')].join(' ')));
    const scored = areas
      .filter((a) => !a.quiet)
      .map((a) => ({ a, hits: [...guessWords(a)].filter((w) => words.has(w)) }))
      .filter((x) => x.hits.length)
      .sort((x, y) => y.hits.length - x.hits.length);
    if (scored.length && (scored.length === 1 || scored[0].hits.length > scored[1].hits.length)) decided.set(u.path, { area: scored[0].a.id, sure: 'guess', why: [`Says “${scored[0].hits[0]}”, one of ${scored[0].a.name}’s words`] });
  }

  // A guess places its neighbours too (a canvas its doc's).
  settle();

  // 6. Where each goes.
  const taken = new Set(all.map((p) => p.toLowerCase()));
  const out: UnitPlan[] = [];
  const counts: Record<string, number> = {};
  for (const u of units.values()) {
    const d = decided.get(u.path);
    const plan: UnitPlan = { ...u, ...(d ? { area: d.area, sure: d.sure, why: d.why } : { sure: 'none' as Sure, why: ['Nothing in the vault says which area'] }) };
    if (d) {
      const area = areas.find((a) => a.id === d.area)!;
      plan.to = freePlace(placeIn(area, u.path, u.folder, attachments), taken, u.folder);
      taken.add(plan.to.toLowerCase());
      counts[d.area] = (counts[d.area] ?? 0) + u.files;
    }
    out.push(plan);
  }
  const order: Record<UnitPlan['kind'], number> = { project: 0, person: 1, meeting: 2, doc: 3, note: 4, file: 5 };
  out.sort((a, b) => order[a.kind] - order[b.kind] || a.title.localeCompare(b.title));
  return { units: out, stays, counts, paths: all };
}

/** A thing's place in an area: its path kept under the area's folder; a loose file of the attachments folder (or a file
 *  at the top) in the area's Files; a note at the top in its Notes. */
export function placeIn(area: Pick<Area, 'folder'>, path: string, folder: boolean, attachmentsFolder = 'Attachments'): string {
  const top = path.includes('/') ? path.slice(0, path.indexOf('/')) : '';
  const rest = path.includes('/') ? path.slice(path.indexOf('/') + 1) : path;
  if (folder) return `${area.folder}/${path}`;
  if (!top) return `${area.folder}/${/\.(md|canvas)$/i.test(path) ? KIND_FOLDERS.notes : KIND_FOLDERS.files}/${path}`;
  if (attachmentsFolder && top.toLowerCase() === cleanDir(attachmentsFolder).toLowerCase()) return `${area.folder}/${KIND_FOLDERS.files}/${rest}`;
  return `${area.folder}/${path}`;
}

/** A place no one has: "Name (2).md" when the place is taken. */
function freePlace(want: string, taken: Set<string>, folder: boolean): string {
  if (!taken.has(want.toLowerCase())) return want;
  const dot = folder ? -1 : want.lastIndexOf('.');
  const stem = dot > want.lastIndexOf('/') ? want.slice(0, dot) : want;
  const ext = dot > want.lastIndexOf('/') ? want.slice(dot) : '';
  for (let n = 2; n < 1000; n++) {
    const p = `${stem} (${n})${ext}`;
    if (!taken.has(p.toLowerCase())) return p;
  }
  return want;
}

/** The person's choices put on the proposal: an area chosen for a thing (or '' to leave it where it is). */
export function withChoices(plan: MigrationPlan, choices: Record<string, string>, areas: Area[], attachmentsFolder = 'Attachments'): MigrationPlan {
  const taken = new Set((plan.paths ?? []).map((p) => p.toLowerCase()));
  const counts: Record<string, number> = {};
  const units = plan.units.map((u) => {
    const choice = choices[u.path];
    let next: UnitPlan = u;
    if (choice === '') next = { ...u, area: undefined, to: undefined, sure: 'none', why: ['You chose to leave it where it is'] };
    else if (choice && choice !== u.area) {
      const area = areas.find((a) => a.id === choice);
      if (area) next = { ...u, area: area.id, sure: 'sure', why: ['You chose it'], to: placeIn(area, u.path, u.folder, attachmentsFolder) };
    }
    if (next.to) {
      const to = freePlace(next.to, taken, next.folder);
      next = { ...next, to };
      taken.add(to.toLowerCase());
      counts[next.area!] = (counts[next.area!] ?? 0) + next.files;
    }
    return next;
  });
  return { ...plan, units, counts };
}

/** The moves to make, in order: folders first, then single things (each [from, to]). */
export function movesOf(plan: MigrationPlan): [string, string][] {
  return plan.units.filter((u) => u.to && u.to !== u.path).sort((a, b) => Number(b.folder) - Number(a.folder)).map((u) => [u.path, u.to!]);
}

/** Every path that moves (each file inside a moved folder too), old → new. */
export function movedPaths(moves: [string, string][], all: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of all) {
    for (const [from, to] of moves) {
      if (p === from) out.set(p, to);
      else if (p.toLowerCase().startsWith(`${from.toLowerCase()}/`)) out.set(p, `${to}${p.slice(from.length)}`);
      else continue;
      break;
    }
  }
  return out;
}

/**
 * Paths written in Ironleaf's own files (views, workspaces, layouts, a canvas's cards, the asset index, sensitivity
 * levels) and in notes' properties (`canvas: Docs/Siteplan.canvas`), brought up to date: any string (or object key) that is
 * a moved path, a moved path with "#…" after it, a moved folder, or "prefix:" and one of those ("project:Projects/X/X.md").
 */
export function followPathsIn(value: unknown, moved: Map<string, string>, folders: [string, string][] = []): { value: unknown; changed: number } {
  let changed = 0;
  const lower = new Map([...moved].map(([a, b]) => [a.toLowerCase(), b]));
  const one = (s: string): string => {
    const m = /^([a-z][a-z-]{0,30}:)?(.*)$/is.exec(s)!;
    const prefix = m[1] && !/^[a-z]:$/i.test(m[1]) ? m[1] : '';
    const body = prefix ? m[2] : s;
    const hash = body.indexOf('#');
    const path = hash > 0 ? body.slice(0, hash) : body;
    const tail = hash > 0 ? body.slice(hash) : '';
    const hit = lower.get(path.toLowerCase()) ?? lower.get(`${path.toLowerCase()}.md`)?.replace(/\.md$/i, '');
    if (hit) {
      changed++;
      return `${prefix}${hit}${tail}`;
    }
    for (const [from, to] of folders) {
      if (path.toLowerCase() === from.toLowerCase()) {
        changed++;
        return `${prefix}${to}${tail}`;
      }
    }
    return s;
  };
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return v.length < 1000 && /[/\\]/.test(v) ? one(v) : v;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k.length < 1000 && k.includes('/') ? one(k) : k] = walk(x);
      return out;
    }
    return v;
  };
  return { value: walk(value), changed };
}

/** The proposal in a few words for the assistant's result and the journal. */
export function planWords(plan: MigrationPlan, areas: Area[]): string {
  const moving = plan.units.filter((u) => u.to);
  const files = moving.reduce((s, u) => s + u.files, 0);
  const by = areas.filter((a) => plan.counts[a.id]).map((a) => `${a.name} ${plan.counts[a.id]}`);
  return `${moving.length} ${moving.length === 1 ? 'thing' : 'things'} (${files} ${files === 1 ? 'file' : 'files'}) into ${by.join(', ') || 'no area'}; ${plan.units.length - moving.length} left where they are.`;
}
