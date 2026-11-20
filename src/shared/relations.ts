// How notes and projects are connected, worked out from what Ironleaf already knows (17 Oct 2026 — eleven project dots
// and no lines, because project files rarely link). The index (src/main/indexer.ts) keeps these current as files change;
// the graph draws them (GraphView.tsx).
//  link      a note links to another                               "Studio Upgrade links to Harbour Fit-out"
//   owns      a project and its own notes (its folder, Activity,    "Kick-off notes belongs to Studio Upgrade"
//             reports made for it, notes whose `project` names it)
//   people    projects sharing a person (People, owner)             "Both have Bettina Maddox"
//   mentions  a note or project file naming another project         "The monthly update mentions SSL Inspection"
//   paired    projects that go together: one place, one closing     "Both in Ashford: one closing, one opening"
//             and one opening (kept conservative)
//   tags      projects sharing a tag                                "Both tagged #garden"
//   (docs)    a doc naming a project or another doc is joined to it  "Minecraft server mentions Home network"
//Pure and standalone (no Node, no DOM): the main process uses it, and tests build it on its own.

import { isProjectProps, parseProject } from './project-file';
import { isDocNote, parseDoc } from './doc-file';
import { makeProjectOwner } from './one-task';

export type RelationKind = 'link' | 'owns' | 'people' | 'mentions' | 'paired' | 'tags';
export const RELATION_KINDS: RelationKind[] = ['link', 'owns', 'people', 'mentions', 'paired', 'tags'];

export interface RelationNote {
  path: string;
  /** The name a person sees (a project's file goes by its project's name). */
  label: string;
  content: string;
  props: Record<string, unknown>;
  tags: string[];
  aliases?: string[];
  /** The notes this one links to, already resolved to their paths. */
  links: string[];
}

export interface Relation {
  /** For a link, the note that links; otherwise the pair in a steady order. */
  source: string;
  target: string;
  kinds: RelationKind[];
  /** Plain words, one per reason: "Both have Bettina Maddox". */
  reasons: string[];
  /** The kind behind each reason, in the same order. */
  reasonKinds: RelationKind[];
  /** How strongly the two belong together (pulls them closer in the graph): about 0.3 to 2. */
  strength: number;
}

export interface Relations {
  /** Each project's file path. */
  projects: string[];
  /** A note that belongs to a project: note path → the project file's path. */
  owner: Map<string, string>;
  /** How many notes belong to each project. */
  noteCount: Map<string, number>;
  relations: Relation[];
}

/** Word sets kept between runs, so a change to one note doesn't re-read the others. */
export type WordCache = Map<string, { content: string; words: Set<string> }>;

const isProject = (n: RelationNote) => isProjectProps(n.props);
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const WORD = /[\p{L}\p{N}]+/gu;

function wordsOf(n: RelationNote, cache?: WordCache): Set<string> {
  const hit = cache?.get(n.path);
  if (hit && hit.content === n.content) return hit.words;
  const words = new Set(n.content.toLowerCase().match(WORD) ?? []);
  cache?.set(n.path, { content: n.content, words });
  return words;
}

/** "a", "a and b", "a, b and 2 others". */
function listWords(items: string[], max = 2): string {
  if (items.length <= 1) return items[0] ?? '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  if (items.length <= max + 1) return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
  const rest = items.length - max;
  return `${items.slice(0, max).join(', ')} and ${rest} other${rest === 1 ? '' : 's'}`;
}

// ── People ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Words that make a "person" a group, a role or email routing, not someone to share (10 Nov 2026: "Q47 on
 *  copy" read as a person; copy/cc/bcc are who the mail went to, never a name). */
const GROUP_WORDS = new Set(['team', 'teams', 'managers', 'manager', 'group', 'department', 'dept', 'staff', 'everyone', 'all', 'finance', 'it', 'hr', 'board', 'vendor', 'vendors', 'supplier', 'suppliers', 'customers', 'customer', 'users', 'stakeholders', 'committee', 'office', 'store', 'stores', 'support', 'desk', 'service', 'services', 'leadership', 'executive', 'executives', 'owners', 'owner', 'tbc', 'tbd', 'unknown', 'n/a', 'none', 'copy', 'cc', 'bcc']);

/** A person's name, the same however it is written ("Dr Bettina Maddox (Tessaly)", "bettina  maddox"), or null for a group. */
const personKeyMemo = new Map<string, string | null>();
export function personKey(raw: string): string | null {
  const k = String(raw ?? '');
  // The same owners cross per record while a model builds: kept (t102, 9 Nov 2026). Pure, so clearing is only slow.
  if (k.length <= 240) {
    const had = personKeyMemo.get(k);
    if (had !== undefined) return had;
  }
  // A name never carries a figure (10 Nov 2026 read as a person): a code, a room, a circuit, never someone.
  // The digits stripped below left "e on copy", which passed as three words.
  if (/\d/.test(k)) {
    if (k.length <= 240) {
      if (personKeyMemo.size > 4000) personKeyMemo.clear();
      personKeyMemo.set(k, null);
    }
    return null;
  }
  let s = k
    .replace(/\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/g, (_, a, b) => b || a)
    .replace(/\([^)]*\)|<[^>]*>|\S+@\S+/g, ' ')
    .replace(/[*_`]/g, '');
  s = s.split(/\s+[—–-]\s+|[,;/|]/)[0];
  s = s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/^\s*(mr|mrs|ms|miss|mx|dr|prof|sir)\.?\s+/, '')
    .replace(/[^\p{L}' -]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = s.split(' ').filter(Boolean);
  // A first name alone could be anyone; a long phrase is a role, not a name.
  if (words.length < 2 || words.length > 4) {
    if (k.length <= 240) {
      if (personKeyMemo.size > 4000) personKeyMemo.clear();
      personKeyMemo.set(k, null);
    }
    return null;
  }
  if (words.some((w) => GROUP_WORDS.has(w))) {
    if (k.length <= 240) {
      if (personKeyMemo.size > 4000) personKeyMemo.clear();
      personKeyMemo.set(k, null);
    }
    return null;
  }
  const out = words.join(' ');
  if (k.length <= 240) {
    if (personKeyMemo.size > 4000) personKeyMemo.clear();
    personKeyMemo.set(k, out);
  }
  return out;
}

/** A person's name as it is best shown: as written, without roles, links or brackets. */
function personShown(raw: string): string {
  return String(raw)
    .replace(/\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/g, (_, a, b) => b || a)
    .replace(/\([^)]*\)|<[^>]*>|\S+@\S+/g, ' ')
    .replace(/[*_`]/g, '')
    .split(/\s+[—–-]\s+|[,;/|]/)[0]
    .replace(/^\s*(mr|mrs|ms|miss|mx|dr|prof|sir)\.?\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Names a project goes by ────────────────────────────────────────────────────────────────────────────────────────

/** Words on the end of a project's name that say what kind of work it is, not which ("Garden Shed Upgrade"). */
const KIND_WORDS = new Set(['upgrade', 'upgrades', 'project', 'rollout', 'roll-out', 'migration', 'implementation', 'deployment', 'programme', 'program', 'refresh', 'uplift', 'replacement', 'pilot', 'setup', 'set-up', 'install', 'installation', 'update', 'updates', 'rooms', 'room', 'meeting', 'teams', 'rebuild', 'review', 'launch', 'fit-out', 'fitout', 'transition', 'onboarding', 'integration', 'renewal', 'works', 'build', 'change', 'changes', 'work', 'phase', 'stage', 'plan', 'initiative', 'remediation', 'cutover', 'go-live', 'decommission', 'audit']);
/** Single words too ordinary to name a project on their own. */
const ORDINARY = new Set(['windows', 'microsoft', 'office', 'store', 'stores', 'new', 'data', 'network', 'security', 'cloud', 'server', 'servers', 'email', 'phone', 'phones', 'project', 'projects', 'team', 'site', 'sites', 'web', 'website', 'app', 'apps', 'mobile', 'global', 'local', 'annual', 'monthly', 'weekly', 'daily', 'finance', 'sales', 'marketing', 'customer', 'support', 'service', 'services', 'system', 'systems', 'platform', 'digital', 'internal', 'external', 'report', 'menu', 'general', 'main', 'other', 'misc', 'notes', 'home', 'work', 'personal', 'admin', 'company', 'business', 'device', 'devices', 'laptop', 'laptops', 'printer', 'printers', 'staff', 'policy', 'training', 'backup', 'backups', 'storage', 'licence', 'licences', 'license', 'licenses', 'wifi', 'internet', 'hardware', 'software', 'update', 'upgrade', 'review', 'launch', 'meeting', 'meetings', 'room', 'rooms', 'winter', 'summer', 'spring', 'autumn', 'today', 'this', 'that', 'with', 'from', 'about']);

interface NameForm {
  text: string;
  words: string[];
  re: RegExp;
}

function makeForm(text: string, caseSensitive: boolean): NameForm {
  const words = text.toLowerCase().match(WORD) ?? [];
  const body = text
    .trim()
    .split(/\s+/)
    .map(escapeRe)
    .join('[\\s\\u00a0]+');
  return { text, words, re: new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, caseSensitive ? 'u' : 'iu') };
}

/**
 * The names a project goes by in other notes: its name, its folder's name, its aliases, and the short forms people write
 * ("Garden Shed" for "01 Garden Shed Upgrade", "Penhallow St Ashford" for "Penhallow St Ashford (Close)"). A short
 * form must still say which project: one ordinary word ("Store") never counts, and one word is matched only as written,
 * with its capital ("Tessaly", not "tessaly"). A lead acronym ("SSL") counts; two letters ("IT") never do, unless the
 * project is actually named that.
 */
export function projectForms(names: string[]): NameForm[] {
  const out = new Map<string, NameForm>();
  const add = (raw: string, whole = false) => {
    const text = raw.replace(/\s+/g, ' ').trim();
    const words = text.match(WORD) ?? [];
    if (!text || out.has(text.toLowerCase())) return;
    if (words.join('').length < 3 && !(whole && /^[A-Z]+$/.test(text))) return;
    if (words.length === 1) {
      const w = words[0];
      // One word: long enough, not ordinary, and written as a name (a capital or a digit). A short all-caps acronym
      // still counts ("SSL" for "SSL Inspection"); two letters only when the project is actually named that ("AI").
      const acronym = /^[A-Z][A-Z0-9]*$/.test(w) && w.length >= (whole ? 2 : 3);
      if ((w.length < 4 && !acronym) || ORDINARY.has(w.toLowerCase()) || KIND_WORDS.has(w.toLowerCase()) || !/[\p{Lu}\p{N}]/u.test(w)) return;
      out.set(text.toLowerCase(), makeForm(text, true));
      return;
    }
    // Ordinary words only ("Studio Upgrade"): the whole name still counts, written as a name, with its capitals.
    const ordinary = words.every((w) => ORDINARY.has(w.toLowerCase()) || KIND_WORDS.has(w.toLowerCase()) || /^\d+$/.test(w));
    if (ordinary && !whole) return;
    out.set(text.toLowerCase(), makeForm(text, ordinary));
  };
  for (const name of names) {
    if (!name) continue;
    const full = name.trim();
    add(full, true);
    const unnumbered = full.replace(/^\s*\d+[\s.)_-]+/, '').trim();
    add(unnumbered, true);
    const plain = unnumbered.replace(/\s*[([][^)\]]*[)\]]\s*/g, ' ').replace(/\s+/g, ' ').trim();
    add(plain);
    // Kind-of-work words off the end, one at a time: "Tessaly Meeting Rooms" → "Tessaly".
    let words = plain.split(' ');
    while (words.length > 1 && KIND_WORDS.has(words[words.length - 1].toLowerCase())) {
      words = words.slice(0, -1);
      add(words.join(' '));
    }
    // A lead acronym names the project too ("SSL" for "SSL Inspection").
    const lead = plain.split(' ')[0] ?? '';
    if (lead.length >= 3 && /^[A-Z][A-Z0-9]*$/.test(lead) && !ORDINARY.has(lead.toLowerCase()) && !KIND_WORDS.has(lead.toLowerCase())) add(lead);
  }
  return [...out.values()];
}

// ── Places and phases (paired) ─────────────────────────────────────────────────────────────────────────────────────

// Words that say a project closes a place or opens one. Bare "open" and "close" count only on their own in brackets or at
// the end of the name ("Penhallow St Ashford (Close)"), so "Open Banking" or "Exit interviews" never pair.
const CLOSING = /\b(closure|closing|closed|close[- ]?down|decommission(?:ing)?|shut[- ]?down|wind[- ]?down)\b|[([]\s*close\s*[)\]]|\bclose\s*$/i;
const OPENING = /\b(launch|opening|grand opening|fit[- ]?out|new site|go[- ]?live)\b|[([]\s*open\s*[)\]]|\bopen\s*$/i;
const PHASE_WORDS = /\b(launch|new|opening|open|grand|fit[- ]?out|site|go[- ]?live|closure|closing|closed|close[- ]?down|close|decommission(?:ing)?|shut[- ]?down|wind[- ]?down)\b/gi;
const STREET = /^(st|street|rd|road|ave|avenue|lane|ln|dr|drive|pl|place|tce|terrace|hwy|highway|blvd|parade|pde|cres|crescent|way|square|sq)\.?$/i;

function phaseOf(texts: string[]): 'closing' | 'opening' | null {
  let close = false;
  let open = false;
  for (const t of texts) {
    if (!t) continue;
    if (CLOSING.test(t)) close = true;
    if (OPENING.test(t)) open = true;
  }
  if (close === open) return null;
  return close ? 'closing' : 'opening';
}

/** The place words in a project's name: proper words, without the street (the word before "St" is the street's name). */
function placesOf(name: string, props: Record<string, unknown>): Set<string> {
  const out = new Set<string>();
  for (const key of ['city', 'location', 'place', 'site', 'region']) {
    const v = props?.[key];
    if (typeof v === 'string' && v.trim()) for (const w of v.match(WORD) ?? []) if (w.length >= 3 && !ORDINARY.has(w.toLowerCase())) out.add(w.toLowerCase());
  }
  const plain = name
    .replace(/^\s*\d+[\s.)_-]+/, '')
    .replace(/[([][^)\]]*[)\]]/g, ' ')
    .replace(PHASE_WORDS, ' ');
  const words = plain.split(/[\s,–—-]+/).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    const w = words[i].replace(/[^\p{L}]/gu, '');
    if (STREET.test(w) || STREET.test(words[i + 1] ?? '')) continue;
    // A place is written as a name: "Ashford", never an acronym or an ordinary word.
    if (!/^\p{Lu}\p{Ll}{2,}$/u.test(w) || ORDINARY.has(w.toLowerCase()) || KIND_WORDS.has(w.toLowerCase())) continue;
    out.add(w.toLowerCase());
  }
  return out;
}

// ── Working it out ─────────────────────────────────────────────────────────────────────────────────────────────────

export function computeRelations(notes: RelationNote[], cache?: WordCache): Relations {
  const byPath = new Map(notes.map((n) => [n.path, n]));
  const projects = notes.filter(isProject);
  const projectPaths = projects.map((p) => p.path);
  const parsed = new Map(projects.map((p) => [p.path, parseProject(p.content, p.path)]));
  const nameOf = (path: string) => byPath.get(path)?.label ?? path;

  // Which project each note belongs to: the one owner rule (src/shared/one-task.ts makeProjectOwner: its `project`
  // property when it names one — deliberate beats incidental — else the deepest folder holding exactly one project).
  const ownerOfNote = makeProjectOwner(projects.map((p) => ({ path: p.path, names: [p.label, parsed.get(p.path)!.name, p.path.split('/').pop()!.replace(/\.md$/i, ''), ...(p.aliases ?? [])] })));
  const owner = new Map<string, string>();
  for (const n of notes) {
    if (isProject(n)) continue;
    const own = ownerOfNote(n.path, n.props?.project);
    if (own) owner.set(n.path, own);
  }
  const noteCount = new Map<string, number>();
  for (const p of owner.values()) noteCount.set(p, (noteCount.get(p) ?? 0) + 1);

  // One relation per pair, every reason gathered on it.
  const rel = new Map<string, Relation>();
  const add = (a: string, b: string, kind: RelationKind, reason: string, strength: number) => {
    if (a === b) return;
    const key = a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
    let r = rel.get(key);
    if (!r) {
      r = { source: a, target: b, kinds: [], reasons: [], reasonKinds: [], strength: 0 };
      rel.set(key, r);
    }
    if (!r.kinds.includes(kind)) r.kinds.push(kind);
    if (reason && !r.reasons.includes(reason)) {
      r.reasons.push(reason);
      r.reasonKinds.push(kind);
      r.strength = Math.min(2.2, r.strength + strength);
    }
  };

  // Links, as written.
  const linked = new Set<string>();
  for (const n of notes) {
    for (const t of n.links) {
      if (t === n.path || !byPath.has(t)) continue;
      linked.add(`${n.path}\u0000${t}`);
      add(n.path, t, 'link', `${n.label} links to ${nameOf(t)}`, 1);
    }
  }

  // A project and its own notes.
  for (const [note, project] of owner) add(project, note, 'owns', `${nameOf(note)} belongs to ${nameOf(project)}`, 1);

  // Someone or something shared by most projects (the person whose projects they all are; a tag on everything) says
  // nothing about which go together.
  const common = (count: number) => projects.length >= 4 && count > Math.max(3, Math.ceil(projects.length * 0.5));

  // People.
  const people = new Map<string, { shown: string; projects: Set<string> }>();
  for (const p of projects) {
    const facts = parsed.get(p.path)!;
    for (const raw of [...facts.people.map((x) => x.name), facts.owner ?? '']) {
      const key = personKey(raw);
      if (!key) continue;
      const entry = people.get(key) ?? { shown: personShown(raw), projects: new Set<string>() };
      entry.projects.add(p.path);
      people.set(key, entry);
    }
  }
  const sharedPeople = new Map<string, string[]>();
  for (const { shown, projects: list } of people.values()) {
    if (list.size < 2 || common(list.size)) continue;
    const ps = [...list].sort();
    for (let i = 0; i < ps.length; i++)
      for (let j = i + 1; j < ps.length; j++) {
        const key = `${ps[i]}\u0000${ps[j]}`;
        sharedPeople.set(key, [...(sharedPeople.get(key) ?? []), shown]);
      }
  }
  for (const [key, names] of sharedPeople) {
    const [a, b] = key.split('\u0000');
    names.sort((x, y) => x.localeCompare(y));
    add(a, b, 'people', `Both have ${listWords(names)}`, 0.45 + 0.2 * Math.min(names.length - 1, 3));
  }

  // Tags.
  const tagged = new Map<string, Set<string>>();
  for (const p of projects) {
    for (const t of new Set([...p.tags, ...parsed.get(p.path)!.tags].map((t) => t.toLowerCase()))) {
      const set = tagged.get(t) ?? new Set<string>();
      set.add(p.path);
      tagged.set(t, set);
    }
  }
  const sharedTags = new Map<string, string[]>();
  for (const [tag, list] of tagged) {
    if (list.size < 2 || common(list.size)) continue;
    const ps = [...list].sort();
    for (let i = 0; i < ps.length; i++)
      for (let j = i + 1; j < ps.length; j++) {
        const key = `${ps[i]}\u0000${ps[j]}`;
        sharedTags.set(key, [...(sharedTags.get(key) ?? []), `#${tag}`]);
      }
  }
  for (const [key, tags] of sharedTags) {
    const [a, b] = key.split('\u0000');
    tags.sort();
    add(a, b, 'tags', `Both tagged ${listWords(tags, 3)}`, 0.25 + 0.12 * Math.min(tags.length - 1, 3));
  }

  // A short acronym two projects share names neither ("API" for two API projects): off both, never a guess.
  const dropSharedAcronyms = (forms: { path: string; forms: NameForm[] }[], nameTexts: string[]) => {
    forms.forEach((f, i) => {
      f.forms = f.forms.filter((form) => {
        if (!(form.words.length === 1 && form.text.length < 4 && /^[A-Z][A-Z0-9]*$/.test(form.text))) return true;
        return !nameTexts.some((t, j) => j !== i && new RegExp(`\\b${form.text.toLowerCase()}\\b`).test(t));
      });
    });
  };
  // Mentions: a note naming a project it isn't part of and doesn't link to.
  const forms = projects.map((p) => {
    const facts = parsed.get(p.path)!;
    return { path: p.path, forms: projectForms([p.label, facts.name, ...(p.aliases ?? [])]) };
  });
  dropSharedAcronyms(forms, projects.map((p) => `${p.label} ${parsed.get(p.path)!.name} ${(p.aliases ?? []).join(' ')}`.toLowerCase()));
  for (const n of notes) {
    if (!forms.length) break;
    const words = wordsOf(n, cache);
    const own = isProject(n) ? n.path : owner.get(n.path);
    for (const f of forms) {
      if (f.path === n.path || f.path === own || linked.has(`${n.path}\u0000${f.path}`)) continue;
      // Every word of the name somewhere in the note before the (slower) exact look.
      const hit = f.forms.find((form) => form.words.every((w) => words.has(w)) && form.re.test(n.content));
      if (hit) add(n.path, f.path, 'mentions', `${n.label} mentions ${hit.text}`, 0.6);
    }
  }

  // Docs: a doc naming a project (above) or another doc is joined to it, unless it already links to it.
  const docs = notes.filter((n) => isDocNote(n.path, n.props));
  const docForms = docs.map((d) => ({ path: d.path, forms: projectForms([d.label, parseDoc(d.content, d.path).name, ...(d.aliases ?? [])]) }));
  dropSharedAcronyms(docForms, docs.map((d) => `${d.label} ${parseDoc(d.content, d.path).name} ${(d.aliases ?? []).join(' ')}`.toLowerCase()));
  for (const n of docs) {
    const words = wordsOf(n, cache);
    for (const f of docForms) {
      if (f.path === n.path || linked.has(`${n.path}\u0000${f.path}`) || linked.has(`${f.path}\u0000${n.path}`)) continue;
      const hit = f.forms.find((form) => form.words.every((w) => words.has(w)) && form.re.test(n.content));
      if (hit) add(n.path, f.path, 'mentions', `${n.label} mentions ${hit.text}`, 0.6);
    }
  }

  // Projects that go together: one place, one closing and one opening.
  const phases = projects.map((p) => {
    const facts = parsed.get(p.path)!;
    return { path: p.path, phase: phaseOf([p.label, facts.name, ...p.tags]), places: placesOf(p.label || facts.name, p.props) };
  });
  for (let i = 0; i < phases.length; i++)
    for (let j = i + 1; j < phases.length; j++) {
      const a = phases[i];
      const b = phases[j];
      if (!a.phase || !b.phase || a.phase === b.phase) continue;
      const place = [...a.places].find((w) => b.places.has(w));
      if (!place) continue;
      const shown = place.replace(/^\p{L}/u, (c) => c.toUpperCase());
      add(a.path, b.path, 'paired', `Both in ${shown}: one closing, one opening`, 1.4);
    }

  return { projects: projectPaths, owner, noteCount, relations: [...rel.values()] };
}
