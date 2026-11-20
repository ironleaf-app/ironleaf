// Relations between notes as links in properties (31 Oct 2026, 8.8 database depth): a property holding [[links]]
// — or plain paths or titles — reads as the records it links to, so a project's "tasks" lists its task notes and a
// task's "project" names its project. Files stay plain Markdown: links are the same [[wikilinks]] notes already use.
// Pure: rollups (views.ts) read through here, and writing one side plans the matching writes on the other side, so
// both directions stay in sync without the person writing anything twice.

import { normalizeTarget, parseWikilink } from './markdown';
import { changeProps, isMachineProp, readProps, type PropValue } from './frontmatter';

export interface LinkedNote {
  path: string;
  title: string;
  /** The note's kind (its type id: person, meeting…), when the caller knows it: pickers filter on it. Left out,
   *  callers judge by their own typeOf instead; the planner never needs it. */
  kind?: string | null;
}

/** Every target a relation value names, in order: each [[link]] inside it, else the words as written. */
export function relationTargets(value: unknown): string[] {
  const out: string[] = [];
  const items = Array.isArray(value) ? value.flat(Infinity) : [value];
  for (const item of items) {
    if (typeof item !== 'string') continue;
    const links = [...item.matchAll(/\[\[([^[\]\n]+)\]\]/g)];
    if (links.length) {
      for (const m of links) {
        const target = parseWikilink(m[1]).target;
        if (target) out.push(target);
      }
    } else if (item.trim()) out.push(item.trim());
  }
  return out;
}

/** The targets named by explicit [[links]] in a value (plain words left out): what may grow a back-link on a note that has
 *  nowhere for it yet. Plain words still read as relations everywhere; they only follow properties already there. */
export function bracketTargets(value: unknown): string[] {
  const out: string[] = [];
  const items = Array.isArray(value) ? value.flat(Infinity) : [value];
  for (const item of items) {
    if (typeof item !== 'string') continue;
    for (const m of item.matchAll(/\[\[([^[\]\n]+)\]\]/g)) {
      const target = parseWikilink(m[1]).target;
      if (target) out.push(target);
    }
  }
  return out;
}

/** Targets resolved to note paths (by path with or without .md, else by title in any case), each once, in order. */
export function resolveRelation(targets: readonly string[], notes: readonly LinkedNote[]): string[] {
  const byPath = new Map<string, string>();
  const byTitle = new Map<string, string>();
  for (const n of notes) {
    byPath.set(normalizeTarget(n.path), n.path);
    const title = n.title.trim().toLowerCase();
    if (title && !byTitle.has(title)) byTitle.set(title, n.path);
  }
  const out: string[] = [];
  for (const t of targets) {
    const hit = byPath.get(normalizeTarget(t)) ?? byTitle.get(t.trim().toLowerCase());
    if (hit && !out.includes(hit)) out.push(hit);
  }
  return out;
}

/** Whether values read as relations: [[links]], or titles of notes when the notes are given (at least half of them). */
export function looksLikeRelation(values: readonly unknown[], notes?: readonly LinkedNote[]): boolean {
  const items = values.flat(Infinity).filter((v): v is string => typeof v === 'string' && !!v.trim());
  if (!items.length) return false;
  const hits = items.filter((s) => /\[\[[^[\]\n]+\]\]/.test(s) || (notes ? resolveRelation([s], notes).length > 0 : false));
  return hits.length * 2 >= items.length;
}

/** A link added to a relation: joined to the list, or the list started; already there, left alone. With the notes,
 *  the same record under other words ("Harbour" and "[[Harbour]]") counts as already there too. */
export function addLink(current: unknown, link: string, notes?: readonly LinkedNote[]): PropValue {
  const items = asItems(current);
  const sameWords = items.some((s) => s.trim().toLowerCase() === link.trim().toLowerCase());
  const sameRecord = !!notes && resolveRelation(relationTargets(link), notes).some((p) => linksTo(items, p, notes));
  if (sameWords || sameRecord) return Array.isArray(current) ? (current as PropValue) : current as PropValue;
  return [...items, link];
}

/**
 * A linked record taken out of a relation (null when nothing is left). A single value goes whole; a list keeps its
 * shape, even down to one. One link of several in a value goes alone; the rest of the value stays.
 */
export function removeLink(current: unknown, targetPath: string, notes: readonly LinkedNote[]): PropValue | null {
  const { kept, changed } = dropFromItems(asItems(current), targetPath, notes);
  if (!kept.length) return null;
  if (Array.isArray(current)) return kept;
  return changed ? kept[0] : (current as PropValue);
}

/** How a note is written as a link: [[its title]], or [[its path]] when another note shares the title. */
export function linkFor(note: LinkedNote, notes: readonly LinkedNote[] = []): string {
  const title = note.title.trim() || note.path.split('/').pop()!.replace(/\.md$/i, '');
  const shared = notes.some((n) => n.path !== note.path && n.title.trim().toLowerCase() === title.toLowerCase());
  return shared ? `[[${note.path.replace(/\.md$/i, '')}]]` : `[[${title}]]`;
}

const ownKey = (props: Record<string, unknown>, key: string): string | undefined => Object.keys(props).find((k) => k.toLowerCase() === key.toLowerCase());
const asItems = (v: unknown): string[] => (Array.isArray(v) ? v.flat(Infinity) : [v]).filter((x): x is string => typeof x === 'string' && !!x.trim());
const linksTo = (items: string[], source: string, notes: readonly LinkedNote[]): boolean =>
  items.some((s) => s === source || resolveRelation(relationTargets(s), notes).includes(source));
/** One item without the links to a record: null when the whole item goes, else the remainder (untouched when no link). */
const dropFromItem = (s: string, targetPath: string, notes: readonly LinkedNote[]): string | null => {
  const links = [...s.matchAll(/\[\[([^\[\]\n]+)\]\]/g)];
  if (!links.length) return linksTo([s], targetPath, notes) ? null : s;
  let out = s;
  let changed = false;
  for (const m of links) {
    const target = parseWikilink(m[1]).target;
    if (target && resolveRelation([target], notes).includes(targetPath)) {
      out = out.replace(m[0], '');
      changed = true;
    }
  }
  if (!changed) return s;
  out = out.replace(/[ \t]+/g, ' ').trim();
  return out ? out : null;
};
/** Items without the links to a record, and whether anything went. */
const dropFromItems = (items: string[], targetPath: string, notes: readonly LinkedNote[]): { kept: string[]; changed: boolean } => {
  const kept: string[] = [];
  let changed = false;
  for (const s of items) {
    const rest = dropFromItem(s, targetPath, notes);
    if (rest === null) {
      changed = true;
      continue;
    }
    if (rest !== s) changed = true;
    kept.push(rest);
  }
  return { kept, changed };
};

export interface RelationSyncPlan {
  source: LinkedNote;
  /** The property written on the source note. */
  key: string;
  /** The records it linked to before, and now (note paths). */
  before: string[];
  after: string[];
  /** The records named by explicit [[links]] (note paths): only these grow a back-link where none is. Left out, every
   *  target may (the seam always passes it; direct callers keep the old behaviour). */
  explicit?: readonly string[];
  propsOf(path: string): Record<string, unknown>;
  notes: readonly LinkedNote[];
}

export interface RelationWrite {
  path: string;
  key: string;
  value: PropValue | null;
  /** The kind sibling kept beside it (its key and value), when the target's kinds change with the links.
   *  Left out when the target has no kind sibling: an added back-link starts unkinded, saying nothing invented. */
  kindKey?: string;
  kindValue?: PropValue | null;
}

/**
 * The writes that keep the other side in sync when a relation changes: each newly linked record gains a link back
 * (into the same property, or the one that already links back), each unlinked one loses it (the property going when
 * nothing is left). A record never links to itself, and records already right are left alone.
 */
export function planRelationSync({ source, key, before, after, explicit, propsOf, notes }: RelationSyncPlan): RelationWrite[] {
  const withSource = notes.some((n) => n.path === source.path) ? notes : [...notes, source];
  const backKey = (target: string): string => {
    const props = propsOf(target);
    const same = ownKey(props, key);
    if (same && (asItems(props[same]).length === 0 || linksTo(asItems(props[same]), source.path, withSource) || !Object.keys(props).some((k) => k !== same && linksTo(asItems(props[k]), source.path, withSource)))) return same;
    const other = Object.keys(props).find((k) => linksTo(asItems(props[k]), source.path, withSource));
    return other ?? same ?? key;
  };
  const out: RelationWrite[] = [];
  for (const target of after) {
    if (target === source.path || before.includes(target)) continue;
    const at = backKey(target);
    const props = propsOf(target);
    const found = ownKey(props, at);
    const actual = found ?? at;
    const items = asItems(found ? props[found] : undefined);
    if (linksTo(items, source.path, withSource)) continue;
    // Plain words follow properties already there; only an explicit [[link]] grows one where none is.
    if (!found && explicit !== undefined && !explicit.includes(target)) continue;
    const write: RelationWrite = { path: target, key: actual, value: [...items, linkFor(source, notes)] };
    // The new back-link is unkinded: a single kind would otherwise be read as applying to it too.
    const sib = ownKey(props, kindKeyFor(actual));
    if (sib) {
      const kinds = readLinkKinds(props, actual, relationTargets(props[actual]).length);
      write.kindKey = sib;
      write.kindValue = writeLinkKinds([...kinds, '']);
    }
    out.push(write);
  }
  for (const target of before) {
    if (target === source.path || after.includes(target)) continue;
    const props = propsOf(target);
    const at = Object.keys(props).find((k) => linksTo(asItems(props[k]), source.path, withSource)) ?? ownKey(props, key);
    if (!at) continue;
    const { kept, changed } = dropFromItems(asItems(props[at]), source.path, withSource);
    if (!changed) continue;
    const write: RelationWrite = { path: target, key: at, value: kept.length ? kept : null };
    const sib = ownKey(props, kindKeyFor(at));
    if (sib) {
      write.kindKey = sib;
      write.kindValue = writeLinkKinds(kindsWithout(props, at, withSource, source.path));
    }
    out.push(write);
  }
  return out;
}

// ── Named kinds of link ────────────────────────────────────────────────────────────────────────────────────────────
// What one note is to another (10.0 Endless Tech, the four: works with, part of, about, follows up), kept in a sibling
// property beside the links ("people" → "people kind") so files stay plain Markdown. One kind applies to every link; a
// list runs parallel to the links in order. Words nobody offered (a kind from a newer version, the person's own) are
// kept as written and shown as written; nothing here renames or drops them. A note without the sibling is unkinded, and
// old files read exactly as before.

/** The kinds the picker offers, in plain words. */
export const LINK_KINDS = ['works with', 'part of', 'about', 'follows up'] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

/** The sibling property holding a relation's kinds ("people" → "people kind"). */
export function kindKeyFor(key: string): string {
  return `${key} kind`;
}

/** Whether a property holds link kinds rather than links: skipped by every relation reader, so a kind word matching a
 *  note's name ("About") never forges a relation. */
export function isKindKey(key: string): boolean {
  return /\s+kind$/i.test(key.trim());
}

/** Each link's kind in order ('' for unkinded): one kind applies to every link, a list runs parallel to the links. */
export function readLinkKinds(props: Record<string, unknown>, key: string, count: number): string[] {
  const own = ownKey(props, kindKeyFor(key));
  const raw = own ? props[own] : undefined;
  const kinds = (Array.isArray(raw) ? raw.flat(Infinity) : [raw]).filter((x): x is string => typeof x === 'string').map((s) => s.trim());
  if (kinds.length <= 1) return Array.from({ length: count }, () => kinds[0] ?? '');
  return Array.from({ length: count }, (_, i) => kinds[i] ?? '');
}

/** Kinds as the sibling property keeps them: nothing (null) when no link is kinded, one kind when every link shares it,
 *  else the list in order ('' where unkinded). */
export function writeLinkKinds(kinds: readonly string[]): PropValue | null {
  const clean = kinds.map((k) => k.trim());
  if (!clean.length || clean.every((k) => !k)) return null;
  const first = clean[0];
  if (clean.every((k) => k === first)) return first;
  return [...clean];
}

/** The sibling value with one link's kind set ('' clears it); null when nothing kinded is left. */
export function setLinkKind(props: Record<string, unknown>, key: string, count: number, index: number, kind: string | null): PropValue | null {
  const kinds = readLinkKinds(props, key, count);
  if (index < 0 || index >= kinds.length) return writeLinkKinds(kinds);
  kinds[index] = (kind ?? '').trim();
  return writeLinkKinds(kinds);
}

/** A property's kinds without the links to one record (every occurrence, as the links themselves go). */
function kindsWithout(props: Record<string, unknown>, key: string, notes: readonly LinkedNote[], targetPath: string): string[] {
  const own = ownKey(props, key);
  const targets = relationTargets(own ? props[own] : undefined);
  const kinds = readLinkKinds(props, key, targets.length);
  return kinds.filter((_, i) => !resolveRelation([targets[i]], notes).includes(targetPath));
}

// ── The one relations seam ───────────────────────────────────────────────────────────────────────────────────────────

/** Properties that are never relations (what a note is, its tags, its other names): a tag matching a note's title must
 *  never grow a back-link there. Skipped by the seam, everywhere. */
export function isStructuralProp(key: string): boolean {
  return /^(type|tags?|aliases?)$/i.test(key.trim());
}

/** A relation property changed between two reads of a note's properties (kind siblings skipped). */
export interface RelationPropChange {
  key: string;
  before: unknown;
  after: unknown;
}

/** Relation properties whose targets changed between two reads of a note's properties (kind siblings skipped). */
export function diffRelationProps(before: Record<string, unknown>, after: Record<string, unknown>): RelationPropChange[] {
  const out: RelationPropChange[] = [];
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (isKindKey(key) || isStructuralProp(key)) continue;
    const ownBefore = ownKey(before, key);
    const ownAfter = ownKey(after, key);
    const was = ownBefore ? before[ownBefore] : undefined;
    const now = ownAfter ? after[ownAfter] : undefined;
    if (JSON.stringify(relationTargets(was)) !== JSON.stringify(relationTargets(now))) out.push({ key, before: was, after: now });
  }
  return out;
}

/** A link to a note of another type than the field wants: named by callers, never silently fixed. */
export interface TypeMismatch {
  /** The link's words as written. */
  target: string;
  path: string;
  /** The linked note's name, for the words that name it. */
  title: string;
  /** The linked note's type id, null when it has none to judge by (a template). */
  actual: string | null;
}

/** Targets resolving to notes of another type than the field wants (unknown targets are dead links, not mismatches). */
export function mismatchedLinks(targets: readonly string[], notes: readonly LinkedNote[], typeOf: (path: string) => string | null, expected: string): TypeMismatch[] {
  const out: TypeMismatch[] = [];
  for (const t of targets) {
    const hit = resolveRelation([t], notes)[0];
    if (!hit) continue;
    const actual = typeOf(hit);
    if (actual && actual !== expected) out.push({ target: t, path: hit, title: notes.find((n) => n.path === hit)?.title ?? hit.split('/').pop()!.replace(/\.md$/i, ''), actual });
  }
  return out;
}

/** A mismatch in plain words ("Harbour review" is a meeting, not a person), the type names lower-cased into the sentence. */
export function mismatchSentence(title: string, actualName: string, expectedName: string): string {
  const low = (s: string): string => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);
  const art = (s: string): string => (/^[aeiou]/i.test(s.trim()) ? 'an' : 'a');
  return `“${title}” is ${art(actualName)} ${low(actualName)}, not ${art(expectedName)} ${low(expectedName)}.`;
}

// ── The picker's pool and words (10.0 Endless Tech, v10records: one kind of record) ────────────────────────────────
// A link field that wants one kind of note offers those notes first and says so; anything else picked is named in
// the same plain words the writer uses, never silently fixed and never blocked (the wiring test pins both).

/** Notes of the kind a field wants, in order: what a link picker offers first. */
export function pickerPool(notes: readonly LinkedNote[], typeOf: (path: string) => string | null, expected: string): LinkedNote[] {
  return notes.filter((n) => (n.kind ?? typeOf(n.path)) === expected);
}

/** A filtered picker's detail words ("Only people shown"), the plural lower-cased into the sentence. */
export function onlyKindShown(plural: string): string {
  const p = plural.trim();
  return `Only ${p ? p.charAt(0).toLowerCase() + p.slice(1) : 'notes'} shown`;
}

/** A picked note of another kind than the field wants, in plain words (null when it agrees or has no kind to judge
 *  by): the picker names it and leaves the choice standing, as the writer does. */
export function pickRefusal(picked: LinkedNote, typeOf: (path: string) => string | null, expected: string, nameOf: (id: string) => string): string | null {
  const actual = picked.kind ?? typeOf(picked.path);
  if (!actual || actual === expected) return null;
  return mismatchSentence(picked.title, nameOf(actual), nameOf(expected));
}

/** Links in a value to notes of another kind than the field wants, in plain words (none when all agrees or the field
 *  wants no kind): named, never blocked or fixed, the same words on every door. */
export function mismatchWords(value: unknown, expected: string | undefined, notes: readonly LinkedNote[], typeOf: (path: string) => string | null, nameOf: (id: string) => string, max = 2): string | null {
  if (!expected) return null;
  const found = mismatchedLinks(relationTargets(value), notes, typeOf, expected);
  if (!found.length) return null;
  return found.slice(0, max).map((m) => mismatchSentence(m.title, nameOf(m.actual!), nameOf(expected))).join(' ');
}

/** Whether a property is the app's own machinery, never a row on any door (6 Nov 2026, break-it 1): the one
 *  list in frontmatter.ts under this door's name, so the two can never drift apart. */
export function isHiddenProp(key: string): boolean {
  return isMachineProp(key);
}

/** Properties shown as their own rows, in order: a kind sibling beside its relation is hidden (shown with its links);
 *  orphaned (no relation beside it), it shows, so it can be taken off. The app's own keeping (frontmatter.ts's one
 *  list, 6 Nov 2026, o3-meeting-page item 1; o6's speaker-names map under it) never shows at all. */
export function shownProps(props: Record<string, unknown>): string[] {
  const linked = new Set(Object.keys(props).map((k) => kindKeyFor(k).toLowerCase()));
  return Object.keys(props).filter((k) => !isMachineProp(k) && !(isKindKey(k) && linked.has(k.toLowerCase())));
}

// ── Kind siblings kept with their relation (10.0 Endless Tech, v10records) ───────────────────────────────────────
// One helper for every door that renames or removes a property, so a relation's kinds are never orphaned: the views
// cell writer and the note Properties use these, and the live fields already cascade the same way.

/** A relation's kind sibling as written ("People Kind" for people), when it has one. */
export function kindSiblingOf(props: Record<string, unknown>, key: string): string | undefined {
  return ownKey(props, kindKeyFor(key));
}

/** Keys to take off when a property goes: itself and its kind sibling, as written, each when present. */
export function cascadeKeysForRemove(props: Record<string, unknown>, key: string): string[] {
  const out: string[] = [];
  const own = ownKey(props, key);
  if (own) out.push(own);
  const sib = kindSiblingOf(props, key);
  if (sib) out.push(sib);
  return out;
}

/** Renames when a property is renamed: itself and its kind sibling following it, as written, each when present. */
export function cascadeRenamesFor(props: Record<string, unknown>, from: string, to: string): { from: string; to: string }[] {
  const out: { from: string; to: string }[] = [];
  const own = ownKey(props, from);
  if (own) out.push({ from: own, to });
  const sib = kindSiblingOf(props, from);
  if (sib) out.push({ from: sib, to: kindKeyFor(to) });
  return out;
}

/** A property value with links to moved notes rewritten (headings and aliases kept); plain titles and paths follow too.
 *  `rewrite` names the new target text for a link target, or null to leave it. */
export function relinkPropValue(value: unknown, rewrite: (target: string) => string | null): { value: PropValue; changed: boolean } {
  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map((v) => {
      const r = relinkPropValue(v, rewrite);
      if (r.changed) changed = true;
      return r.value;
    });
    return changed ? { value: out as PropValue, changed } : { value: value as PropValue, changed: false };
  }
  if (typeof value !== 'string' || !value.trim()) return { value: value as PropValue, changed: false };
  const links = [...value.matchAll(/\[\[([^[\]\n]+)\]\]/g)];
  if (!links.length) {
    const to = rewrite(value.trim());
    return to !== null && to !== value.trim() ? { value: to, changed: true } : { value, changed: false };
  }
  let out = value;
  let changed = false;
  for (const m of links) {
    const link = parseWikilink(m[1]);
    if (!link.target) continue;
    const to = rewrite(link.target);
    if (to === null || to === link.target) continue;
    out = out.replace(m[0], `[[${to}${link.heading ? `#${link.heading}` : ''}${link.alias ? `|${link.alias}` : ''}]]`);
    changed = true;
  }
  return { value: out, changed };
}

/** A note's text with every property link to a moved note rewritten (the body untouched); the same text when none. A
 *  note whose properties cannot be read is left alone: one bad note never breaks a rename. */
export function relinkPropsInText(content: string, rewrite: (target: string) => string | null): string {
  let props: Record<string, unknown>;
  try {
    props = readProps(content);
  } catch {
    return content;
  }
  const next = new Map<string, PropValue>();
  for (const [k, v] of Object.entries(props)) {
    if (isKindKey(k)) continue;
    const r = relinkPropValue(v, rewrite);
    if (r.changed) next.set(k, r.value);
  }
  if (!next.size) return content;
  try {
    return changeProps(content, (doc) => {
      for (const [k, v] of next) doc.set(k, v);
    });
  } catch {
    return content;
  }
}

export interface UnlinkWrite {
  key: string;
  value: PropValue | null;
  kindKey?: string;
  kindValue?: PropValue | null;
}

/** A note's properties without the links to one record (for trash): each changed key with its value and kind value. */
export function unlinkPathFromProps(props: Record<string, unknown>, path: string, notes: readonly LinkedNote[]): UnlinkWrite[] {
  const out: UnlinkWrite[] = [];
  for (const key of Object.keys(props)) {
    if (isKindKey(key) || isStructuralProp(key)) continue;
    const value = props[key];
    if (!relationTargets(value).length || !resolveRelation(relationTargets(value), notes).includes(path)) continue;
    const write: UnlinkWrite = { key, value: removeLink(value, path, notes) };
    const sib = ownKey(props, kindKeyFor(key));
    if (sib) {
      write.kindKey = sib;
      write.kindValue = writeLinkKinds(kindsWithout(props, key, notes, path));
    }
    out.push(write);
  }
  return out;
}
