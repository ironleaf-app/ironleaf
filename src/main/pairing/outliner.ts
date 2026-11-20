// Outliners: Logseq's graph folder and Roam's JSON export (V12, 28 Oct 2026). Both keep a page as a tree of blocks;
// both let a block be referred to by its id — ((id)) — and drawn in another page — {{embed ((id))}}; both mark tasks
// with words (TODO, DONE) and give a page properties as "key:: value". In the vault: a page becomes a note whose blocks
// are a nested list, a block someone refers to carries " ^id" (src/shared/blocks.ts) so the reference becomes
// [[Note#^id]] and the embed ![[Note#^id]], tasks become tick boxes, page properties go to the top of the note, and
// journal pages become the vault's daily notes. Read from the open file formats alone.

import { promises as fsp } from 'node:fs';
import nodePath from 'node:path';
import type { PropValue } from '../../shared/frontmatter';
import { roamAssetLink, type RoamSiblings } from './roam-assets';
import { fileSafe, firstWords, isoDay, linkToken, tagSafe, type SourceFile, type SourceItem, type SourceRead } from './source';

const PROP_LINE = /^([A-Za-z][\w-]*)::[ \t]*(.*)$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** An id as a block id can be written (letters, digits, dashes). */
const blockId = (id: string) => id.replace(/[^A-Za-z0-9-]/g, '-').replace(/^-+/, '');

/** A property's words as a value: "a, b" lists for tags and aliases, [[links]] unwrapped there. */
function propValue(key: string, raw: string): PropValue {
  const t = raw.trim();
  if (/^(tags|alias|aliases)$/i.test(key)) return t.split(',').map((s) => s.trim().replace(/^\[\[|\]\]$/g, '').replace(/^#/, '')).filter(Boolean).map((s) => (/^tags$/i.test(key) ? tagSafe(s) : s));
  if (/^-?\d+(\.\d+)?$/.test(t) && t.length < 16) return Number(t);
  if (/^(true|false)$/i.test(t)) return t.toLowerCase() === 'true';
  return t;
}

interface Pages {
  /** A page's name (lower case, aliases too) → its id. */
  byName: Map<string, string>;
  /** A block's id → its page's id and its words (for a reference's label). */
  blocks: Map<string, { page: string; text: string }>;
  /** Block ids something refers to (only those carry ^id). */
  referred: Set<string>;
}

/** A block's words in vault Markdown: references, embeds, page links, tags, tasks and the outliner's own marks. */
function inline(text: string, pages: Pages, o: { roam: boolean }): string {
  let s = text;
  const ref = (id: string, embed: boolean) => {
    const b = pages.blocks.get(id);
    if (!b) return embed ? '' : `((${id}))`;
    return linkToken(embed ? 'embed-note' : 'note', `${b.page}#^${blockId(id)}`, embed ? '' : firstWords(cleanLabel(marker(b.text)), 50));
  };
  const page = (name: string, embed: boolean, label = '') => {
    const id = pages.byName.get(name.trim().toLowerCase());
    if (!id) return embed ? `![[${name}]]` : label ? `[${label}](${name})` : `[[${name}]]`;
    // A link written to an alias keeps the words written ("[[Veggie patch]]" to the page Garden).
    return linkToken(embed ? 'embed-note' : 'note', id, label || (id !== `page:${name.trim().toLowerCase()}` ? name.trim() : ''));
  };
  // Embeds first (they hold a reference or a link inside).
  s = s.replace(/\{\{(?:\[\[)?embed(?:\]\])?:?\s*\(\(([^()\s]+)\)\)\s*\}\}/gi, (_, id: string) => ref(id, true));
  s = s.replace(/\{\{(?:\[\[)?embed(?:\]\])?:?\s*\[\[([^\]]+)\]\]\s*\}\}/gi, (_, name: string) => page(name, true));
  // Tasks written as Roam's buttons.
  s = s.replace(/^\{\{\[\[TODO\]\]\}\}\s*|^\{\{TODO\}\}\s*/, '[ ] ').replace(/^\{\{\[\[DONE\]\]\}\}\s*|^\{\{DONE\}\}\s*/, '[x] ');
  // Roam's [label]([[Page]]) and a link written to a reference.
  s = s.replace(/\[([^\]\n]+)\]\(\[\[([^\]]+)\]\]\)/g, (_, label: string, name: string) => page(name, false, label));
  s = s.replace(/\(\(([^()\s]+)\)\)/g, (_, id: string) => ref(id, false));
  // Tags: #[[two words]] → #two-words; a page link stays a link to the page.
  s = s.replace(/#\[\[([^\]]+)\]\]/g, (_, t: string) => `#${tagSafe(t)}`);
  s = s.replace(/(^|[^!\w])\[\[([^\]\n]+)\]\]/g, (_, before: string, name: string) => `${before}${page(name, false)}`);
  if (o.roam) s = s.replace(/__([^_\n]+)__/g, '*$1*').replace(/\^\^([^^\n]+)\^\^/g, '==$1==');
  return s;
}

const cleanLabel = (t: string) => t.replace(/\(\([^)]*\)\)/g, '').replace(/\[\[([^\]]*)\]\]/g, '$1').replace(/\{\{[^}]*\}\}/g, '').replace(/[*_=~`#]/g, '').replace(/^\[[ x]\]\s*/, '');

/** A task marker at a block's start as a tick box. */
function marker(text: string): string {
  const m = /^(TODO|DOING|NOW|LATER|WAIT|WAITING|DONE|CANCELED|CANCELLED)\s+/.exec(text);
  if (!m) return text;
  const rest = text.slice(m[0].length);
  if (m[1] === 'DONE') return `[x] ${rest}`;
  if (m[1].startsWith('CANCEL')) return `[x] ~~${rest}~~`;
  return `[ ] ${rest}`;
}

// ── Logseq ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Whether a folder is a Logseq graph. */
export async function isLogseqGraph(root: string): Promise<boolean> {
  const has = async (p: string) => fsp.stat(nodePath.join(root, p)).then(() => true, () => false);
  return (await has('logseq/config.edn')) || ((await has('pages')) && (await has('journals')));
}

/** A page file's name as its page name: "a___b" and "a%2Fb" are the namespace "a/b". */
export function logseqPageName(file: string): string {
  let s = file.replace(/\.(md|markdown|org)$/i, '').replace(/___/g, '/');
  try {
    s = decodeURIComponent(s);
  } catch {
    // as written
  }
  return s;
}

interface LsBlock {
  depth: number;
  lines: string[];
  props: [string, string][];
  id?: string;
}

/** A Logseq page's text as its page properties and its blocks (depth from the bullet's indent). */
function parseLogseq(text: string): { props: [string, string][]; blocks: LsBlock[] } {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const props: [string, string][] = [];
  const blocks: LsBlock[] = [];
  let i = 0;
  // Page properties: "key:: value" lines before the first bullet (or as the first bullet's only words).
  while (i < lines.length && (PROP_LINE.test(lines[i].trim()) || !lines[i].trim())) {
    const m = PROP_LINE.exec(lines[i].trim());
    if (m) props.push([m[1], m[2]]);
    i++;
  }
  let cur: LsBlock | null = null;
  for (; i < lines.length; i++) {
    const raw = lines[i];
    const lead = /^[\t ]*/.exec(raw)![0];
    const width = lead.replace(/\t/g, '  ').length;
    const bullet = /^[\t ]*[-*] (.*)$/.exec(raw) ?? (/^[\t ]*[-*]$/.test(raw) ? ['', ''] : null);
    if (bullet) {
      cur = { depth: Math.floor(width / 2), lines: [bullet[1]], props: [] };
      blocks.push(cur);
      continue;
    }
    if (!cur) {
      if (raw.trim()) {
        cur = { depth: 0, lines: [raw.trim()], props: [] };
        blocks.push(cur);
      }
      continue;
    }
    const m = PROP_LINE.exec(raw.trim());
    if (m) {
      if (m[1] === 'id') cur.id = m[2].trim();
      else if (m[1] !== 'collapsed' && m[1] !== 'heading') cur.props.push([m[1], m[2]]);
      continue;
    }
    cur.lines.push(raw.slice(Math.min(raw.length, lead.length)).replace(/^ {0,2}/, ''));
  }
  // Blank lines at a block's end are only the space before the next one.
  for (const b of blocks) while (b.lines.length > 1 && !b.lines[b.lines.length - 1].trim()) b.lines.pop();
  // The first block holding only properties is the page's properties.
  if (!props.length && blocks[0] && blocks[0].lines.every((l) => !l.trim()) && blocks[0].props.length) props.push(...blocks.shift()!.props);
  return { props, blocks };
}

export async function readLogseq(root: string): Promise<SourceRead> {
  const files: { rel: string; text: string; journal: boolean }[] = [];
  for (const sub of ['pages', 'journals']) {
    for (const n of await fsp.readdir(nodePath.join(root, sub)).catch(() => [] as string[])) {
      if (!/\.(md|markdown)$/i.test(n)) continue;
      files.push({ rel: `${sub}/${n}`, text: await fsp.readFile(nodePath.join(root, sub, n), 'utf8'), journal: sub === 'journals' });
    }
  }
  const skipped: { what: string; why: string }[] = [];
  const orgs = [...(await fsp.readdir(nodePath.join(root, 'pages')).catch(() => [] as string[])), ...(await fsp.readdir(nodePath.join(root, 'journals')).catch(() => [] as string[]))].filter((n) => /\.org$/i.test(n)).length;
  if (orgs) skipped.push({ what: `${orgs} Org pages`, why: 'only Markdown pages come in' });
  // Every file in the graph, so relative links resolve against what is there (F24), not just assets/.
  const have = new Set<string>();
  let capped = false;
  const listAll = async (rel: string, depth: number) => {
    if (depth > 6 || have.size > 5000) {
      capped = true;
      return;
    }
    for (const e of await fsp.readdir(rel ? nodePath.join(root, ...rel.split('/')) : root, { withFileTypes: true }).catch(() => [])) {
      if (e.name.startsWith('.')) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await listAll(r, depth + 1);
      else if (e.isFile()) have.add(r.toLowerCase());
    }
  };
  await listAll('', 0);
  if (capped) skipped.push({ what: 'Some files deep in the graph', why: 'only the first levels were looked at' });
  const pages: Pages = { byName: new Map(), blocks: new Map(), referred: new Set() };
  const parsed = files.map((f) => {
    const p = parseLogseq(f.text);
    const day = f.journal ? /^(\d{4})[_-](\d{2})[_-](\d{2})/.exec(f.rel.split('/').pop()!) : null;
    const title = p.props.find(([k]) => k === 'title')?.[1]?.trim() || (day ? `${day[1]}-${day[2]}-${day[3]}` : logseqPageName(f.rel.split('/').pop()!));
    const id = `page:${title.toLowerCase()}`;
    pages.byName.set(title.toLowerCase(), id);
    for (const [k, v] of p.props) if (/^alias(es)?$/i.test(k)) for (const a of propValue('alias', v) as string[]) if (!pages.byName.has(a.toLowerCase())) pages.byName.set(a.toLowerCase(), id);
    for (const b of p.blocks) if (b.id) pages.blocks.set(b.id, { page: id, text: b.lines.join(' ') });
    return { ...f, ...p, title, id, day: day ? `${day[1]}-${day[2]}-${day[3]}` : undefined };
  });
  // Which blocks are referred to (only they carry an id in the vault).
  for (const f of files) for (const m of f.text.matchAll(/\(\(([0-9a-f-]{36})\)\)/gi)) pages.referred.add(m[1]);
  const items: SourceItem[] = [];
  for (const f of parsed) {
    const own: SourceFile[] = [];
    const missing: string[] = [];
    const miss = (href: string) => {
      if (!missing.includes(href)) missing.push(href);
    };
    const body: string[] = [];
    for (const b of f.blocks) {
      const indent = '  '.repeat(b.depth);
      const [first, ...rest] = b.lines;
      let text = marker(first ?? '');
      text = withAssets(inline(text, pages, { roam: false }), root, f.rel, own, have, miss);
      const keepId = b.id && pages.referred.has(b.id) ? ` ^${blockId(b.id)}` : '';
      const cont = rest.map((l) => `${indent}  ${withAssets(inline(l, pages, { roam: false }), root, f.rel, own, have, miss)}`);
      const fields = b.props.map(([k, v]) => `${indent}  ${k}:: ${v}`);
      if (cont.length) {
        body.push(`${indent}- ${text}`, ...cont.slice(0, -1), `${cont[cont.length - 1]}${keepId}`, ...fields);
      } else body.push(`${indent}- ${text}${keepId}`, ...fields);
    }
    const props: Record<string, PropValue> = {};
    for (const [k, v] of f.props) {
      if (k === 'title' || k === 'id') continue;
      props[/^alias$/i.test(k) ? 'aliases' : k] = propValue(k, v);
    }
    if (missing.length) skipped.push({ what: f.title, why: `${missing.length === 1 ? 'a file it links to' : `${missing.length} files it links to`} couldn’t be found (${missing.slice(0, 3).join(', ')}${missing.length > 3 ? `, and ${missing.length - 3} more` : ''})` });
    const parts = f.title.split('/').map((p) => fileSafe(p));
    items.push({ id: f.id, title: f.day ?? parts[parts.length - 1], folder: f.day ? '' : parts.slice(0, -1).join('/'), props, body: body.length ? `${body.join('\n')}\n` : '', files: own, ...(f.day ? { day: f.day } : {}) });
  }
  return { kind: 'logseq', name: nodePath.basename(root), items, views: [], skipped };
}

/** Pictures and files a page shows: every relative link resolved against the graph (F24) and brought with the page;
 *  one that points nowhere is left as words and reported. A link from the graph root (/diagrams/x.png) resolves there. */
function withAssets(s: string, root: string, from: string, own: SourceFile[], have: Set<string>, miss: (href: string) => void): string {
  return s.replace(/(!?)\[([^\]\n]*)\]\(([^)\s]+)\)/g, (all, bang: string, label: string, href: string) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return all;
    let target = href;
    try {
      target = decodeURIComponent(href);
    } catch {
      // as written
    }
    // From the graph root when written so (10.0 item 16), else from the page.
    const rel = target.startsWith('/') ? nodePath.posix.normalize(target.replace(/^\/+/, '')) : nodePath.posix.normalize(nodePath.posix.join(nodePath.posix.dirname(from), target));
    if (rel.startsWith('..') || !have.has(rel.toLowerCase())) {
      if (/\.[a-z0-9]{1,5}(?:[?#]|$)/i.test(target)) miss(href);
      return label || all;
    }
    const f = { key: `logseq/${rel.toLowerCase()}`, name: fileSafe(rel.split('/').pop()!, 'File'), abs: nodePath.join(root, ...rel.split('/')) };
    if (!own.some((x) => x.key === f.key)) own.push(f);
    return bang ? linkToken('embed-file', f.key) : linkToken('file', f.key, label || f.name);
  });
}

// ── Roam ────────────────────────────────────────────────────────────────────────────────────────────────────────────

interface RoamBlock {
  string?: string;
  uid?: string;
  heading?: number;
  children?: RoamBlock[];
  'create-time'?: number;
  'edit-time'?: number;
}
interface RoamPage {
  title?: string;
  uid?: string;
  children?: RoamBlock[];
  'create-time'?: number;
  'edit-time'?: number;
}

/** Whether a parsed JSON is a Roam graph export. */
export const isRoamExport = (j: unknown): j is RoamPage[] => Array.isArray(j) && j.length > 0 && j.slice(0, 5).every((p) => p && typeof p === 'object' && typeof (p as RoamPage).title === 'string' && (!('children' in p) || Array.isArray((p as RoamPage).children)));

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
/** Roam's daily page title ("October 28th, 2026") as its day. */
export function roamDay(title: string): string | null {
  const m = /^([A-Z][a-z]+) (\d{1,2})(?:st|nd|rd|th), (\d{4})$/.exec(title.trim());
  const mo = m ? MONTHS.indexOf(m[1].toLowerCase()) : -1;
  if (!m || mo < 0) return null;
  const d = new Date(Number(m[3]), mo, Number(m[2]));
  return d.getMonth() === mo ? isoDay(d) : null;
}

export function readRoam(json: RoamPage[], name: string, siblings?: RoamSiblings): SourceRead {
  const pages: Pages = { byName: new Map(), blocks: new Map(), referred: new Set() };
  const idOf = (p: RoamPage) => `page:${(p.title ?? '').toLowerCase()}`;
  const walk = (bs: RoamBlock[] | undefined, page: string) => {
    for (const b of bs ?? []) {
      if (b.uid) pages.blocks.set(b.uid, { page, text: b.string ?? '' });
      for (const m of (b.string ?? '').matchAll(/\(\(([^()\s]+)\)\)/g)) pages.referred.add(m[1]);
      walk(b.children, page);
    }
  };
  for (const p of json) {
    if (!p.title) continue;
    pages.byName.set(p.title.toLowerCase(), idOf(p));
    walk(p.children, idOf(p));
  }
  const items: SourceItem[] = [];
  const skipped: { what: string; why: string }[] = [];
  for (const p of json) {
    if (!p.title) continue;
    const props: Record<string, PropValue> = {};
    const top = [...(p.children ?? [])];
    // Attributes at the top of a page ("Type:: Book") are its properties.
    while (top.length && !top[0].children?.length && PROP_LINE.test((top[0].string ?? '').trim())) {
      const m = PROP_LINE.exec(top.shift()!.string!.trim())!;
      props[m[1]] = propValue(m[1], m[2]);
    }
    const lines: string[] = [];
    const put = (bs: RoamBlock[], depth: number) => {
      for (const b of bs) {
        const [first, ...rest] = (b.string ?? '').replace(/\r\n?/g, '\n').split('\n');
        const keepId = b.uid && pages.referred.has(b.uid) ? ` ^${blockId(b.uid)}` : '';
        const text = inline(marker(first), pages, { roam: true });
        const indent = '  '.repeat(depth);
        if (depth === 0 && b.heading && b.heading >= 1 && b.heading <= 3) {
          lines.push('', `${'#'.repeat(b.heading + 1)} ${text}${keepId}`, '');
          put(b.children ?? [], 0);
          continue;
        }
        const cont = rest.map((l) => `${indent}  ${inline(l, pages, { roam: true })}`);
        if (cont.length) lines.push(`${indent}- ${text}`, ...cont.slice(0, -1), `${cont[cont.length - 1]}${keepId}`);
        else lines.push(`${indent}- ${text}${keepId}`);
        put(b.children ?? [], depth + 1);
      }
    };
    put(top, 0);
    // A file link with no web address (F23, 10.0 item 16): beside the export it comes with the page, else words, said.
    const own: SourceFile[] = [];
    const missing: string[] = [];
    const miss = (href: string) => {
      if (!missing.includes(href)) missing.push(href);
    };
    for (let i = 0; i < lines.length; i++) {
      lines[i] = lines[i].replace(/(!?)\[([^\]\n]*)\]\(([^)\s]+)\)/g, (all: string, bang: string, label: string, href: string) => {
        if (siblings) return roamAssetLink(all, bang, label, href, siblings, own, miss);
        if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#')) return all;
        if (!/\.[a-z0-9]{1,5}(?:[?#]|$)/i.test(href)) return all;
        miss(href);
        return label || (bang ? '(a picture not in the export)' : href);
      });
    }
    if (missing.length) skipped.push({ what: p.title, why: `${missing.length === 1 ? 'a file it links to' : `${missing.length} files it links to`} isn’t in the export (${missing.slice(0, 3).join(', ')}${missing.length > 3 ? `, and ${missing.length - 3} more` : ''})` });
    const day = roamDay(p.title);
    if (p['create-time']) props.created = isoDay(new Date(p['create-time']));
    const parts = p.title.split('/').map((x) => fileSafe(x));
    items.push({ id: idOf(p), title: day ?? parts[parts.length - 1], folder: day ? '' : parts.slice(0, -1).join('/'), props, body: lines.length ? `${lines.join('\n').replace(/^\n+/, '').replace(/\n{3,}/g, '\n\n')}\n` : '', files: own, ...(day ? { day } : {}) });
  }
  if (siblings?.capped) skipped.push({ what: 'Some files beside the export', why: 'only the first levels were looked at' });
  return { kind: 'roam', name, items, views: [], skipped };
}

export { UUID };
