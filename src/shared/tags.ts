// The tag manager (Wave 4, 24 Oct 2026; the plan: "Tags are polluted. Colour codes show up as tags. Nothing curates
// the tag list."). A tag renamed, merged into another or taken off, in every note at once: in the words (#tag, and its
// sub-tags #tag/sub) and in the `tags:` property, everything else in the note left exactly as it was. Colour codes and
// numbers after a # aren't tags at all any more (src/shared/markdown.ts isNotATag).
//
// Pure: the main side (src/main/life.ts) runs it over the notes and writes the ones it changed.

import { changeProps, frontMatterRange, isScalar, isSeq } from './frontmatter';
import { isNotATag, maskCode } from './markdown';

/** A tag as people may type it: without its #, spaces made dashes. Null when it can't be a tag. */
export function cleanTag(raw: string): string | null {
  const t = String(raw ?? '')
    .trim()
    .replace(/^#+/, '')
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}_/-]/gu, '')
    .replace(/\/{2,}/g, '/')
    .replace(/^\/|\/$/g, '');
  if (!t || isNotATag(t)) return null;
  return t;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Whether a tag is the one asked for or one of its sub-tags (#area and #area/home). */
const under = (tag: string, from: string) => same(tag, from) || tag.toLowerCase().startsWith(`${from.toLowerCase()}/`);

/** The tags property changed: each tag (or sub-tag) `from` becomes `to` (null takes it off); a tag already there once. */
function changeTagsProp(content: string, from: string, to: string | null): string {
  const range = frontMatterRange(content);
  if (!range || !/^(tags?)\s*:/im.test(range.yaml)) return content;
  let changed = false;
  const next = changeProps(content, (doc) => {
    for (const key of ['tags', 'tag', 'Tags']) {
      const node = doc.get(key, true);
      if (node === undefined || node === null) continue;
      const list = isSeq(node) ? node.items.map((i) => (isScalar(i) ? String(i.value) : String(i))) : isScalar(node) ? String(node.value).split(',').map((s) => s.trim()).filter(Boolean) : null;
      if (!list) continue;
      const out: string[] = [];
      for (const raw of list) {
        const had = raw.replace(/^#/, '');
        if (!under(had, from)) {
          if (!out.some((x) => same(x, raw))) out.push(raw);
          continue;
        }
        changed = true;
        if (to === null) continue;
        const now = `${raw.startsWith('#') ? '#' : ''}${to}${had.slice(from.length)}`;
        if (!out.some((x) => same(x.replace(/^#/, ''), now.replace(/^#/, '')))) out.push(now);
      }
      if (!changed) continue;
      if (isSeq(node)) {
        const flow = node.flow;
        const seq = doc.createNode(out) as typeof node;
        seq.flow = flow;
        doc.set(key, seq);
      } else doc.set(key, out.join(', '));
    }
  });
  return changed ? next : content;
}

/** The words changed: each #from (and #from/sub) becomes #to (null takes the tag off, with the space before it). Code,
 *  inline code and properties are left alone. */
function changeTagWords(content: string, from: string, to: string | null): string {
  const masked = maskCode(content);
  const re = new RegExp(`(^|[\\s(])#(${esc(from)})((?:/[\\p{L}\\p{N}_-]+)*)(?![\\p{L}\\p{N}_-])`, 'giu');
  let out = '';
  let at = 0;
  for (const m of masked.matchAll(re)) {
    const start = (m.index ?? 0) + m[1].length; // the #
    const end = (m.index ?? 0) + m[0].length;
    if (to === null) {
      // Take the space before it too when the tag stands between words, so no double space is left.
      const cut = m[1] === ' ' || m[1] === '\t' ? start - 1 : start;
      out += content.slice(at, cut);
    } else out += `${content.slice(at, start)}#${to}${content.slice(start + 1 + m[2].length, end)}`;
    at = end;
  }
  return at ? out + content.slice(at) : content;
}

/** A note with a tag renamed (or merged into one already there): its words and its tags property. */
export function renameTag(content: string, from: string, to: string): string {
  const f = cleanTag(from);
  const t = cleanTag(to);
  if (!f || !t || f === t) return content;
  return changeTagWords(changeTagsProp(content, f, t), f, t);
}

/** A note with a tag taken off (and its sub-tags): its words and its tags property. */
export function removeTag(content: string, tag: string): string {
  const f = cleanTag(tag);
  if (!f) return content;
  return changeTagWords(changeTagsProp(content, f, null), f, null);
}

/** A note with one tag added to its tags property (kept once, any case; the rest untouched). */
export function addTag(content: string, tag: string): string {
  const name = cleanTag(tag);
  if (!name) return content;
  return changeProps(content, (doc) => {
    const node = doc.get('tags', true);
    const had = node === undefined || node === null ? [] : isSeq(node) ? node.items.map((i) => (isScalar(i) ? String(i.value) : String(i))) : isScalar(node) ? String(node.value).split(',').map((s) => s.trim()).filter(Boolean) : [];
    if (had.some((t) => t.toLowerCase() === name.toLowerCase())) return;
    // Written back the way it was written (a list stays a list, a line stays a line).
    doc.set('tags', isScalar(node) ? [...had, name].join(', ') : [...had, name]);
  });
}

export interface TagUse {
  tag: string;
  count: number;
  /** The notes it is on. */
  paths: string[];
}

/** Every tag with the notes it is on (the notes' tags as the index read them), leaving out some notes (templates). */
export function tagUses(notes: readonly { path: string; tags: string[] }[], skip: (path: string) => boolean = () => false): TagUse[] {
  const by = new Map<string, TagUse>();
  for (const n of notes) {
    if (skip(n.path)) continue;
    for (const t of n.tags) {
      if (isNotATag(t)) continue;
      const key = t;
      const u = by.get(key) ?? { tag: t, count: 0, paths: [] };
      u.count++;
      u.paths.push(n.path);
      by.set(key, u);
    }
  }
  return [...by.values()].sort((a, b) => a.tag.localeCompare(b.tag));
}

/** Tags that are probably one written two ways ("AV" and "av", "weekly-update" and "weekly-updates"), for the merge
 *  suggestions. */
export function similarTags(uses: readonly TagUse[]): [TagUse, TagUse][] {
  const out: [TagUse, TagUse][] = [];
  const norm = (t: string) => t.toLowerCase().replace(/[-_\s]+/g, '').replace(/s$/, '');
  for (let i = 0; i < uses.length; i++)
    for (let j = i + 1; j < uses.length; j++) if (uses[i].tag !== uses[j].tag && norm(uses[i].tag) === norm(uses[j].tag)) out.push(uses[i].count > uses[j].count || (uses[i].count === uses[j].count && /\p{Lu}/u.test(uses[i].tag) && !/\p{Lu}/u.test(uses[j].tag)) ? [uses[i], uses[j]] : [uses[j], uses[i]]);
  return out;
}

/** A list of tags from what a tool was given: a list, or words split by commas and spaces. */
export function tagList(raw: unknown): string[] {
  const items = Array.isArray(raw) ? raw.map(String) : typeof raw === 'string' ? raw.split(/[,\s]+/) : [];
  const out: string[] = [];
  for (const item of items) {
    const t = cleanTag(item);
    if (t && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
  }
  return out;
}

/**
 * A note's tags after a change (8.0 V1, 28 Oct 2026: setting tags replaced the whole list, so "tag it #client" wiped the
 * note's other tags). Tags given are added to those there; remove takes some away; only replace: true makes the list
 * exactly what was given. Every AI's tag change goes through this: the side chat's set_properties and the catalogue's
 * note_set_properties.
 */
export function changedTags(existing: unknown, o: { add?: unknown; remove?: unknown; replace?: boolean }): string[] {
  const add = tagList(o.add);
  const gone = new Set(tagList(o.remove).map((t) => t.toLowerCase()));
  const base = o.replace ? [] : tagList(existing);
  const out = [...base];
  for (const t of add) if (!out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
  return out.filter((t) => !gone.has(t.toLowerCase()));
}
