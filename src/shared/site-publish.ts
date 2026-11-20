// Publish as a website (9.0 w122publish, 31 Oct 2026, approved "as long as you can add all that functionality without
// having to get approvals from companies"): chosen Vault pages as a finished static site the person puts where they
// like. No hosting account with us, no company's approval: the Vault builds the whole site (this module, pure: no
// files, no window), writes it to a folder the person chooses, and, inside the former host app, sends those same
// files through the former host app's own Publish destinations (src/main/site-publish.ts, the host's publish code).
// One page, a project, a folder, a tag or a hand-picked list; home page, side navigation, one page per note drawn as
// the Vault draws it, links kept or turned to words (never broken), pictures and files copied, search over the pages,
// light and dark by the reader's setting, the person's accent, and opened straight from the folder with no server
// (relative links only, the search index inside the search page: nothing fetched). Never published: private notes,
// Secrets (links become the stand-in), anything not Open (health, a pack's marked records, a set level), publish:
// false, and hidden properties.

import { PRIVATE_STANDIN, SECRET_STANDIN, withoutPrivate, withoutSecrets } from './share';
import { isPrivatePath } from './private';
import { levelLabel, levelOf, type SensitivityStore } from './sensitivity';

export { PRIVATE_STANDIN, SECRET_STANDIN };

export const SITES_FILE = '.neuralvault/sites.json';

/** A site's build limits (every host takes these too). */
export const SITE_LIMITS = { notes: 5000, note: 2 * 1024 * 1024, attachment: 25 * 1024 * 1024, attachments: 2000 };

export type SiteSource =
  | { kind: 'page'; path: string }
  | { kind: 'project'; path: string }
  | { kind: 'folder'; folder: string }
  | { kind: 'tag'; tag: string }
  | { kind: 'list'; paths: string[] };

export interface SiteDef {
  id: string;
  name: string;
  description: string;
  source: SiteSource;
  /** The folder it is written to ('' until the person chooses). */
  folder: string;
  /** The person's accent (a #rrggbb), for the site's links and marks. */
  accent: string;
  /** A host destination in the former host app (its id and the settings it was published with), else folder only. */
  host: { id: string; settings: Record<string, unknown> } | null;
  createdAt: string;
  publishedAt: string;
  /** What the last publish said, in plain words. */
  lastWords: string;
}

export interface NoteMeta {
  path: string;
  title: string;
  props: Record<string, unknown>;
  tags: string[];
  /** When the note last changed (ms), for the home page's order (most recently changed first). */
  mtime?: number;
}

export interface ResolvedSite {
  included: { path: string; title: string }[];
  excluded: { path: string; title: string; reason: string }[];
}

const cleanRel = (p: unknown): string => (typeof p === 'string' ? p.replace(/\\/g, '/').replace(/^\/+/, '').trim() : '');
const isNoteRel = (rel: string): boolean => /\.md$/i.test(rel);
const isOwn = (rel: string): boolean => rel === '.neuralvault' || rel.startsWith('.neuralvault/');
const dirOf = (p: string): string => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const baseOf = (p: string): string => p.split('/').pop() ?? p;
const titleOf = (m: NoteMeta): string => m.title?.trim() || baseOf(m.path).replace(/\.md$/i, '').replace(/_/g, ' ');

const falsy = (v: unknown): boolean => /^(false|no|off|0)$/i.test(String(v ?? '').trim());
const truthy = (v: unknown): boolean => /^(true|yes|on|1)$/i.test(String(v ?? '').trim());

/** Why a note is never published ('' when it may go): private, publish: false, or a level above Open. */
export function exclusionOf(rel: string, props: Record<string, unknown>, store: SensitivityStore): string {
  if (isPrivatePath(rel)) return 'Private notes stay private.';
  if ('publish' in props && falsy(props.publish)) return 'Marked publish: false.';
  if (truthy(props.private) || /^private$/i.test(String(props.visibility ?? ''))) return 'Marked private.';
  const { level } = levelOf(store, rel, props.sensitivity, props.type, props.area);
  if (level !== 'open') return `Marked ${levelLabel(level)}.`;
  return '';
}

/** A project's own notes: the project file and every note in its folder. */
function inProject(rel: string, projectPath: string): boolean {
  if (rel === projectPath) return true;
  const dir = dirOf(projectPath);
  return dir !== '' && rel.startsWith(`${dir}/`);
}

/** The notes a source names, with what is left out and why. Sorted by path, so a site keeps its order. */
export function resolveSitePages(source: SiteSource, notes: NoteMeta[], store: SensitivityStore): ResolvedSite {
  const byPath = new Map(notes.map((n) => [cleanRel(n.path).toLowerCase(), n]));
  let wanted: NoteMeta[] = [];
  if (source.kind === 'page') {
    const n = byPath.get(cleanRel(source.path).toLowerCase());
    if (n) wanted = [n];
  } else if (source.kind === 'project') {
    const at = cleanRel(source.path);
    wanted = notes.filter((n) => inProject(cleanRel(n.path), at));
  } else if (source.kind === 'folder') {
    const at = cleanRel(source.folder).toLowerCase().replace(/\/+$/, '');
    wanted = notes.filter((n) => {
      const rel = cleanRel(n.path).toLowerCase();
      return at === '' ? true : rel === at || rel.startsWith(`${at}/`);
    });
  } else if (source.kind === 'tag') {
    const want = source.tag.trim().toLowerCase().replace(/^#/, '');
    wanted = notes.filter((n) => n.tags.some((t) => t.toLowerCase() === want));
  } else {
    wanted = source.paths.map((p) => byPath.get(cleanRel(p).toLowerCase())).filter((n): n is NoteMeta => !!n);
    wanted = [...new Map(wanted.map((n) => [cleanRel(n.path).toLowerCase(), n])).values()];
  }
  const included: ResolvedSite['included'] = [];
  const excluded: ResolvedSite['excluded'] = [];
  const seen = new Set<string>();
  for (const n of wanted) {
    const rel = cleanRel(n.path);
    if (seen.has(rel.toLowerCase())) continue;
    seen.add(rel.toLowerCase());
    const title = titleOf(n);
    if (!isNoteRel(rel) || isOwn(rel)) {
      excluded.push({ path: rel, title, reason: 'Only notes are published.' });
      continue;
    }
    const why = exclusionOf(rel, n.props ?? {}, store);
    if (why) {
      excluded.push({ path: rel, title, reason: why });
      continue;
    }
    included.push({ path: rel, title });
  }
  included.sort((a, b) => a.path.localeCompare(b.path));
  if (included.length > SITE_LIMITS.notes) {
    const rest = included.splice(SITE_LIMITS.notes);
    for (const r of rest) excluded.push({ ...r, reason: `More than ${SITE_LIMITS.notes} notes: one site holds ${SITE_LIMITS.notes}.` });
  }
  return { included, excluded };
}

/** A page's address in the site: its folders and name made web-safe, unique (the caller fills taken first). */
export function slug(text: string): string {
  return (
    String(text ?? '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'page'
  );
}

export function pageUrlFor(rel: string, taken: Set<string>): string {
  const noExt = rel.replace(/\.md$/i, '');
  const dir = noExt.includes('/') ? `${noExt.slice(0, noExt.lastIndexOf('/')).split('/').map(slug).join('/')}/` : '';
  const base = `${dir}${slug(baseOf(noExt))}`;
  let url = `${base}.html`;
  let k = 2;
  while (taken.has(url) || url === 'index.html' || url === 'search.html') url = `${base}-${k++}.html`;
  taken.add(url);
  return url;
}

const esc = (s: unknown): string => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const decodeSafe = (s: string): string => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};
const EXTERNAL = /^(https?:|mailto:)/i;
const UNSAFE_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const IMG_EXT = /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)$/i;
/** A data: picture (kept in place, small ones only). */
const DATA_IMG = /^data:image\/(png|jpe?g|gif|webp|avif|bmp);base64,[a-z0-9+/=\s]+$/i;

export interface SiteVault {
  /** A link target as written → the vault path it names (a note or a file), else null. */
  resolve(target: string, from: string): string | null;
  /** A vault file's bytes (null: not there, or not a file the site takes). */
  read(rel: string): Uint8Array | null;
}

/** A [[link]]'s target without its #heading or |alias. */
function wikiTarget(inner: string): { target: string; heading: string; alias: string } {
  const pipe = inner.indexOf('|');
  const alias = pipe >= 0 ? inner.slice(pipe + 1).trim() : '';
  const rest = (pipe >= 0 ? inner.slice(0, pipe) : inner).trim();
  const hash = rest.indexOf('#');
  return { target: (hash >= 0 ? rest.slice(0, hash) : rest).trim().replace(/\.md$/i, ''), heading: (hash >= 0 ? rest.slice(hash + 1) : '').trim().replace(/^\^/, ''), alias };
}

const mdText = (s: string): string => String(s).replace(/([\\[\\]*_`])/g, '\\$1');
const mdUrl = (u: string): string => u.split('/').map((p) => encodeURIComponent(decodeSafe(p))).join('/');

export interface RenderPage {
  /** This page's vault path (links resolve from it). */
  from: string;
  /** This page's address in the site (its links are relative to it, so the folder opens with no server). */
  url: string;
  /** Every published note's vault path (lower-cased, .md dropped) → its address in the site. */
  urls: Map<string, string>;
  /** A vault file wanted for the site (its bytes are copied to files/). */
  wantFile(rel: string): string | null;
}

/** One site address relative to another page ('baking/lemon-cake.html' → 'files/cake.png' is '../files/cake.png'). */
export function relUrl(from: string, to: string): string {
  const a = from.split('/').slice(0, -1);
  const b = to.split('/');
  while (a.length && b.length && a[0] === b[0]) {
    a.shift();
    b.shift();
  }
  return [...a.map(() => '..'), ...b].join('/');
}

/** A page's first picture as the home page shows it: a page-relative address resolved to the site's root (home
 *  sits at the root), a web address as it is. Pasted-in pictures stay on their page (inlining them again would
 *  bloat the home page); '' when the page has no picture for its card. */
function firstCardImage(html: string, pageUrl: string): string {
  const src = /<img\s[^>]*src="([^"]+)"/i.exec(html)?.[1] ?? '';
  if (!src || /^data:/i.test(src) || src.startsWith('#') || (UNSAFE_SCHEME.test(src) && !EXTERNAL.test(src))) return '';
  if (EXTERNAL.test(src)) return src;
  const parts: string[] = [];
  for (const seg of [...pageUrl.split('/').slice(0, -1), ...src.split('/')]) {
    if (seg === '..') parts.pop();
    else if (seg !== '.' && seg !== '') parts.push(seg);
  }
  return parts.join('/');
}

/** Outside fenced code and `spans` (links there are words, never rewritten). */
function outsideCode(text: string, fn: (chunk: string) => string): string {
  const parts = text.split(/(^(?:```|~~~)[^\n]*\n[\s\S]*?^(?:```|~~~)[^\n]*$|`[^`\n]+`)/m);
  return parts.map((p, i) => (i % 2 ? p : fn(p))).join('');
}

/** Every link of a page made ready: published notes to their page, files to their copy, the rest to plain words. */
function rewriteLinks(body: string, page: RenderPage, vault: SiteVault): string {
  const keyOf = (target: string): string | null => {
    const rel = vault.resolve(target, page.from);
    if (!rel) return null;
    const key = rel.replace(/\\/g, '/').replace(/\.md$/i, '').toLowerCase();
    return page.urls.has(key) ? key : null;
  };
  // One pass (a link made from a wikilink is never read again).
  const LINKS = /(!?)\[\[([^\][\n]+?)\]\]|(!?)\[([^\]\n]*)\]\(\s*(<[^>\n]+>|[^)\s]+)(?:\s+"[^"]*")?\s*\)/g;
  const one = (chunk: string): string =>
    chunk.replace(LINKS, (all, bang: string, inner: string, mdBang: string, label: string, href: string) => {
      if (href === undefined) {
        const { target, heading, alias } = wikiTarget(inner);
        if (!target && heading) return `[${mdText(alias || heading)}](#${slug(heading)})`;
        if (!target) return all;
        const key = keyOf(target);
        if (key) {
          const words = alias || baseOf(target).replace(/\.md$/i, '').replace(/_/g, ' ');
          const hash = heading ? `#${slug(heading)}` : '';
          // A note embedded shows as a link to its page (its words stay on its own page).
          return `[${mdText(words)}](${mdUrl(relUrl(page.url, page.urls.get(key)!))}${hash})`;
        }
        const rel = vault.resolve(target, page.from);
        if (rel && !/\.md$/i.test(rel)) {
          const url = page.wantFile(rel);
          if (url) {
            const shown = alias && !/^\d+(x\d+)?$/.test(alias) ? alias : baseOf(rel);
            if (bang === '!' && IMG_EXT.test(rel)) return `![${mdText(alias && /^\d+(x\d+)?$/.test(alias) ? `|${alias}` : shown)}](${mdUrl(relUrl(page.url, url))})`;
            return `[${mdText(shown)}](${mdUrl(relUrl(page.url, url))})`;
          }
        }
        return mdText(alias || baseOf(target).replace(/_/g, ' '));
      }
      const target = decodeSafe(href.replace(/^<|>$/g, '').trim());
      if (!target || EXTERNAL.test(target) || target.startsWith('#')) return all;
      if (/^secret:/i.test(target)) return SECRET_STANDIN;
      if (UNSAFE_SCHEME.test(target)) return label || '';
      const clean = target.replace(/[?#].*$/, '');
      const hash = /#(.*)$/.exec(target)?.[1] ?? '';
      if (/\.md$/i.test(clean) || !/\.[a-z0-9]{1,8}$/i.test(baseOf(clean))) {
        const key = keyOf(clean.replace(/\.md$/i, ''));
        if (key) return `[${label}](${mdUrl(relUrl(page.url, page.urls.get(key)!))}${hash ? `#${slug(decodeSafe(hash))}` : ''})`;
        const rel = !/\.[a-z0-9]{1,8}$/i.test(baseOf(clean)) ? vault.resolve(clean, page.from) : null;
        if (rel && !/\.md$/i.test(rel)) {
          const url = page.wantFile(rel);
          if (url) return `${mdBang}[${label || mdText(baseOf(rel))}](${mdUrl(relUrl(page.url, url))})`;
        }
        return label || mdText(baseOf(clean).replace(/_/g, ' '));
      }
      const rel = vault.resolve(clean, page.from);
      if (rel && !/\.md$/i.test(rel)) {
        const url = page.wantFile(rel);
        if (url) return `${mdBang}[${label}](${mdUrl(relUrl(page.url, url))})`;
      }
      return label || '';
    });
  return outsideCode(String(body ?? ''), one);
}

/** One line's own marks: pictures, links (published and web kept), bold, italics, code, marks. Everything escaped
 *  first, so raw HTML in a note is never run (as the Vault reads it). */
function inline(src: string): string {
  const keep: string[] = [];
  const hold = (html: string): string => `\u0001${keep.push(html) - 1}\u0001`;
  let t = esc(src);
  t = t.replace(/%%[^%\n]*%%/g, '');
  t = t.replace(/`([^`\n]+)`/g, (_, c: string) => hold(`<code>${c}</code>`));
  t = t.replace(/\$\$([^$\n]+)\$\$/g, (_, m: string) => hold(`<span class="math">${m}</span>`));
  t = t.replace(/(^|[^$\w])\$([^$\s][^$\n]*?)\$(?!\w)/g, (_, p: string, m: string) => `${p}${hold(`<span class="math">${m}</span>`)}`);
  t = t.replace(/&lt;(https?:\/\/[^\s&]+)&gt;/g, (_, u: string) => hold(`<a href="${u}">${u}</a>`));
  t = t.replace(/!\[([^\]\n]*)\]\(([^)\s]+)\)/g, (_, alt: string, u: string) => {
    const url = decodeSafe(u);
    // A pasted-in picture stays in place when small; a large one would bloat the page, so its words stay instead.
    if (/^data:image\//i.test(url) && (!DATA_IMG.test(url) || url.length > 400000)) return alt.replace(/\|\d+(x\d+)?$/, '');
    if (!url || (UNSAFE_SCHEME.test(url) && !EXTERNAL.test(url) && !/^data:image\//i.test(url))) return alt.replace(/\|\d+(x\d+)?$/, '');
    const size = /\|(\d+)(?:x(\d+))?$/.exec(alt);
    const words = alt.replace(/\|\d+(x\d+)?$/, '');
    const dims = size ? ` width="${size[1]}"${size[2] ? ` height="${size[2]}"` : ''}` : '';
    return hold(`<img src="${url}" alt="${words}"${dims}>`);
  });
  t = t.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (_, label: string, u: string) => {
    const url = decodeSafe(u);
    if (url.startsWith('#')) return hold(`<a href="#${slug(decodeSafe(url.slice(1)))}">${label}</a>`);
    if (EXTERNAL.test(url)) return hold(`<a href="${url}" target="_blank" rel="noopener noreferrer">${label || url}</a>`);
    if (UNSAFE_SCHEME.test(url) || /^data:/i.test(url)) return label;
    return hold(`<a href="${url}">${label}</a>`);
  });
  // Bare addresses, after the written links (never inside them: those are held aside by now).
  t = t.replace(/(^|[\s(])(https?:\/\/[^\s\u0001<]+)/g, (_, p: string, u: string) => `${p}${hold(`<a href="${u}">${u.replace(/&amp;/g, '&')}</a>`)}`);
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_]+)__/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, '$1<em>$2</em>').replace(/(^|[^_\w])_([^_\s][^_]*?)_(?!\w)/g, '$1<em>$2</em>');
  t = t.replace(/~~([^~]+)~~/g, '<del>$1</del>').replace(/==([^=\n]+)==/g, '<mark>$1</mark>');
  return t.replace(/\u0001(\d+)\u0001/g, (_, i: string) => keep[Number(i)] ?? '');
}

/** A callout's tint (the Vault's kinds, its names). */
function calloutTint(kind: string): string {
  const k = kind.toLowerCase();
  if (['tip', 'hint', 'success', 'check', 'done'].includes(k)) return 'green';
  if (['warning', 'caution', 'attention'].includes(k)) return 'amber';
  if (['danger', 'error', 'failure', 'fail', 'missing'].includes(k)) return 'red';
  if (['quote', 'cite', 'example'].includes(k)) return 'grey';
  return 'blue';
}

/** A note's body as HTML: headings (with ids, so #links land), tables, tick-boxes, callouts, code, quotes, rules. */
export function renderSiteBody(body: string): string {
  const lines = String(body ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  const ids = new Map<string, number>();
  const hid = (words: string): string => {
    const base = slug(words.replace(/<[^>]*>/g, '')) || 'part';
    const k = ids.get(base) ?? 0;
    ids.set(base, k + 1);
    return k ? `${base}-${k + 1}` : base;
  };
  let i = 0;
  const para: string[] = [];
  const flush = (): void => {
    if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`);
    para.length = 0;
  };
  const LIST = /^(\s*)(?:([-+*])|(\d+)[.)])\s+(.*)$/;
  const listAt: { ordered: boolean }[] = [];
  const closeLists = (to = 0): void => {
    while (listAt.length > to) out.push(listAt.pop()!.ordered ? '</ol>' : '</ul>');
  };
  while (i < lines.length) {
    const line = lines[i]!;
    let m: RegExpExecArray | null;
    if ((m = /^(\s*)(```|~~~)\s*([\w-]*)/.exec(line))) {
      flush();
      closeLists();
      const fence = m[2];
      const lang = (m[3] ?? '').toLowerCase();
      const code: string[] = [];
      for (i++; i < lines.length && !lines[i]!.startsWith(`${m[1]}${fence}`) && !lines[i]!.trimStart().startsWith(fence); i++) code.push(lines[i]!);
      i++;
      if (lang === 'mermaid') out.push(`<div class="diagram"><div class="diagram-head">Diagram</div><pre><code>${esc(code.join('\n'))}</code></pre></div>`);
      else if (lang === 'math') out.push(`<div class="math-block">${esc(code.join('\n'))}</div>`);
      else out.push(lang ? `<div class="code-block"><div class="code-block-head"><span>${esc(lang)}</span></div><pre><code>${esc(code.join('\n'))}</code></pre></div>` : `<pre><code>${esc(code.join('\n'))}</code></pre>`);
      continue;
    }
    if (!line.trim()) {
      flush();
      closeLists();
      i++;
      continue;
    }
    if ((m = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line))) {
      flush();
      closeLists();
      const html = inline(m[2].replace(/\s*\^[\w-]+$/, ''));
      out.push(`<h${m[1].length} id="${hid(m[2])}">${html}</h${m[1].length}>`);
      i++;
      continue;
    }
    if (/^\s{0,3}(---|\*\*\*|___)\s*$/.test(line)) {
      flush();
      closeLists();
      out.push('<hr>');
      i++;
      continue;
    }
    if (/^\s*>/.test(line)) {
      flush();
      closeLists();
      const quote: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i]!)) quote.push(lines[i++]!.replace(/^\s*>\s?/, ''));
      const first = quote[0] ?? '';
      const call = /^\[!([\w-]+)\]([+-]?)\s*(.*)$/.exec(first);
      if (call) {
        const tint = calloutTint(call[1]);
        const title = call[3].trim() || call[1];
        const rest = quote.slice(1).join('\n').trim();
        out.push(`<div class="callout ${tint}"><div class="callout-title">${esc(title)}</div>${rest ? `<div class="callout-content">${renderSiteBody(rest)}</div>` : ''}</div>`);
      } else {
        out.push(`<blockquote>${renderSiteBody(quote.join('\n'))}</blockquote>`);
      }
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      flush();
      closeLists();
      const rows: string[][] = [];
      for (; i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]!); i++) rows.push(lines[i]!.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').trim()));
      const ruled = rows.length > 1 && rows[1]!.every((c) => /^:?-{2,}:?$/.test(c));
      const align = ruled ? rows[1]!.map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : '')) : [];
      const head = ruled ? rows[0]! : null;
      const rest = rows.slice(ruled ? 2 : 0).filter((r) => !r.every((c) => /^:?-{2,}:?$/.test(c)));
      const cell = (tag: string) => (c: string, k: number): string => `<${tag}${align[k] ? ` style="text-align:${align[k]}"` : ''}>${inline(c)}</${tag}>`;
      out.push(`<table>${head ? `<thead><tr>${head.map(cell('th')).join('')}</tr></thead>` : ''}<tbody>${rest.map((r) => `<tr>${r.map(cell('td')).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    if ((m = LIST.exec(line))) {
      flush();
      const indent = Math.min(6, Math.floor(m[1].replace(/\t/g, '  ').length / 2));
      const ordered = !!m[3];
      while (listAt.length > indent + 1 || (listAt.length === indent + 1 && listAt[listAt.length - 1]!.ordered !== ordered)) closeLists(listAt.length - 1);
      while (listAt.length < indent + 1) {
        const isOrdered = ordered && listAt.length === indent;
        out.push(isOrdered ? '<ol>' : '<ul>');
        listAt.push({ ordered: isOrdered });
      }
      const task = /^\[([ xX])\]\s+(.*)$/.exec(m[4]);
      if (task) out.push(`<li class="task${task[1] === ' ' ? '' : ' done'}"><input type="checkbox" disabled${task[1] === ' ' ? '' : ' checked'}> ${inline(task[2])}</li>`);
      else out.push(`<li>${inline(m[4])}</li>`);
      i++;
      continue;
    }
    const footnoteDef = /^\[\^([^\]]+)\]:\s+(.*)$/.exec(line.trim());
    if (footnoteDef) {
      flush();
      closeLists();
      out.push(`<p class="footnote"><span class="footnote-mark">[${esc(footnoteDef[1])}]</span> ${inline(footnoteDef[2])}</p>`);
      i++;
      continue;
    }
    para.push(line.trim());
    i++;
  }
  flush();
  closeLists();
  return out.join('\n');
}

/** A source in plain words for the dialog and Settings ("Project: Riverside Pop-up", "Tag: sourdough"). */
export function describeSource(source: SiteSource, titleOfPath: (rel: string) => string = (rel) => baseOf(rel).replace(/\.md$/i, '')): string {
  if (source.kind === 'page') return `One page: ${titleOfPath(cleanRel(source.path))}`;
  if (source.kind === 'project') return `Project: ${titleOfPath(cleanRel(source.path))}`;
  if (source.kind === 'folder') return cleanRel(source.folder) ? `Folder: ${cleanRel(source.folder)}` : 'Every note';
  if (source.kind === 'tag') return `Tag: ${source.tag.trim().replace(/^#/, '')}`;
  return source.paths.length === 1 ? `One page: ${titleOfPath(cleanRel(source.paths[0]))}` : `${source.paths.length} chosen pages`;
}

/** The person's accent, or the Vault's own when it isn't a colour. */
export function cleanAccent(v: unknown): string {
  return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim().toLowerCase() : '#e85d3f';
}

// ── The site's look: white and cool, light and dark by the reader's setting, the person's accent ────────────────────

export const SITE_CSS = `:root{--bg:#ffffff;--ink:#23272e;--muted:#5d6672;--line:#e4e8ee;--soft:#f3f5f8;--code:#f3f5f8;--accent:#e85d3f;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--bg:#16191e;--ink:#e8ebf0;--muted:#9aa3b0;--line:#2c313a;--soft:#1e2229;--code:#1e2229}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:17px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
.wrap{display:flex;min-height:100vh}
nav.side{width:264px;flex:none;border-right:1px solid var(--line);padding:22px 18px;position:sticky;top:0;height:100vh;overflow:auto;background:var(--bg)}
nav.side .name{font-weight:700;font-size:18px;margin:0 0 2px}nav.side .name a{color:var(--ink)}
nav.side .about{color:var(--muted);font-size:13.5px;margin:0 0 14px}
nav.side ul{list-style:none;margin:0;padding:0}nav.side li{margin:0}
nav.side li a{display:block;color:var(--ink);padding:5px 10px;border-radius:8px;font-size:15px}
nav.side li a:hover{background:var(--soft);text-decoration:none}
nav.side li.here a{background:var(--soft);font-weight:600}
nav.side .search-link{margin-top:12px;font-size:15px}
main{flex:1;min-width:0;max-width:780px;margin:0 auto;padding:40px 32px 80px}
h1,h2,h3,h4{line-height:1.3;margin:1.5em 0 .5em}h1{font-size:2rem;margin-top:0}
img{max-width:100%;height:auto;border-radius:8px}
pre,code{font:14px/1.55 ui-monospace,SFMono-Regular,Consolas,monospace}
pre{background:var(--code);border-radius:10px;padding:14px 16px;overflow:auto}
code{background:var(--code);border-radius:6px;padding:.1em .35em}pre code{background:none;padding:0}
.code-block{margin:1em 0}.code-block-head{font-size:12.5px;color:var(--muted);margin-bottom:4px;text-transform:uppercase;letter-spacing:.04em}
blockquote{margin:1em 0;padding:.2em 1.1em;border-left:3px solid var(--line);color:var(--muted)}
blockquote p{margin:.5em 0}
.callout{margin:1.1em 0;padding:12px 16px;border-radius:10px;background:var(--soft);border:1px solid var(--line)}
.callout-title{font-weight:650;margin-bottom:2px}.callout-content>:first-child{margin-top:.3em}.callout-content>:last-child{margin-bottom:.3em}
.callout.blue{border-left:4px solid #4a7fc9}.callout.green{border-left:4px solid #3f9e63}
.callout.amber{border-left:4px solid #c99a3f}.callout.red{border-left:4px solid #c0524a}.callout.grey{border-left:4px solid #8a94a3}
table{border-collapse:collapse;width:100%;margin:1.1em 0;font-size:15.5px}
th,td{border:1px solid var(--line);padding:7px 11px;text-align:left}th{background:var(--soft)}
ul.task-list,li.task{list-style:none}ul:has(>li.task){padding-left:6px}li.task{margin:.15em 0}
li.task input{margin-right:.4em;accent-color:var(--accent)}li.task.done{color:var(--muted)}
hr{border:0;border-top:1px solid var(--line);margin:2em 0}
.math{font-family:Georgia,serif;background:var(--code);border-radius:6px;padding:.1em .4em}
.math-block{background:var(--code);border-radius:10px;padding:14px 16px;margin:1em 0;overflow:auto;font-family:Georgia,serif}
.diagram{margin:1em 0}.diagram-head{font-size:12.5px;color:var(--muted);margin-bottom:4px;text-transform:uppercase;letter-spacing:.04em}
.footnote{color:var(--muted);font-size:15px}.footnote-mark{font-weight:650;margin-right:.3em}
.props{margin:0 0 1.4em;padding:0;list-style:none;display:flex;flex-wrap:wrap;gap:6px 16px;font-size:14px;color:var(--muted)}
.props b{font-weight:600;color:var(--ink)}
.home-head{margin:0 0 1.7em}.home-head h1{margin:0 0 .12em}.home-head p{margin:0;color:var(--muted);font-size:17px}
.home-cards{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:16px;align-items:start}
.home-card a{display:flex;flex-direction:column;height:100%;color:var(--ink);border:1px solid var(--line);border-radius:12px;overflow:hidden;background:var(--bg)}
.home-card a:hover{text-decoration:none;border-color:var(--accent)}
.home-card a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.home-card-img{display:block;aspect-ratio:16/9;background:var(--soft);overflow:hidden}
.home-card-img img{width:100%;height:100%;object-fit:cover;border-radius:0}
.home-card-words{display:flex;flex-direction:column;gap:2px;padding:12px 14px 14px}
.home-card-title{font-weight:650;font-size:16.5px}
.home-card-first{color:var(--muted);font-size:14.5px;overflow-wrap:break-word}
.home-empty{color:var(--muted)}
.search-box input{width:100%;font:inherit;padding:10px 14px;border:1px solid var(--line);border-radius:10px;background:transparent;color:var(--ink)}
.search-box ol{list-style:none;padding:0}.search-box li{padding:12px 0;border-bottom:1px solid var(--line)}
.search-box li p{margin:4px 0 0;color:var(--muted);font-size:15px}
footer.site{color:var(--muted);font-size:13px;margin-top:56px}
@media (max-width:760px){.wrap{display:block}nav.side{width:auto;height:auto;position:static;border-right:0;border-bottom:1px solid var(--line)}main{padding:28px 20px 64px}}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
@media (prefers-color-scheme:dark){main a,nav.side .search-link a{color:color-mix(in srgb,var(--accent) 60%,#fff)}li.task input{accent-color:color-mix(in srgb,var(--accent) 60%,#fff)}}`;

/** The search page's script: the index is in the page (no fetch, so the folder opens with no server). */
export const SEARCH_JS = `(()=>{const box=document.getElementById('q'),list=document.getElementById('results'),note=document.getElementById('note');const index=window.__siteIndex||[];
const words=s=>String(s||'').toLowerCase().normalize('NFKD').replace(/[\\u0300-\\u036f]/g,'').split(/[^a-z0-9]+/).filter(Boolean);
const show=()=>{const q=words(box.value);list.replaceChildren();if(!q.length){note.textContent='Type to search every page.';return}
const found=[];for(const p of index){const hay=(p.t+' '+p.x).toLowerCase().normalize('NFKD').replace(/[\\u0300-\\u036f]/g,'');if(!q.every(w=>hay.includes(w)))continue;found.push({p,score:q.reduce((n,w)=>n+(p.t.toLowerCase().includes(w)?5:0),0)})}
found.sort((a,b)=>b.score-a.score);const top=found.slice(0,50);
note.textContent=top.length?top.length+(top.length===1?' page':' pages'):'Nothing found.';
for(const {p} of top){const li=document.createElement('li'),a=document.createElement('a'),x=document.createElement('p');a.href=p.u;a.textContent=p.t;const at=p.x.toLowerCase().indexOf(q[0]);x.textContent=(at>60?'…':'')+p.x.slice(Math.max(0,at-60),Math.max(0,at-60)+200)+'…';li.append(a,x);list.append(li)}};
const q=new URLSearchParams(location.search).get('q');if(q)box.value=q;show();box.addEventListener('input',show)})();`;

export interface SitePage {
  url: string;
  title: string;
  html: string;
  /** Plain words for the search index and the sharing description. */
  text: string;
  description: string;
  /** When the note last changed (ms), for the home page's order. */
  mtime: number;
  /** The page's first picture as the home page shows it (site-root-relative, or a web address), else ''. */
  image: string;
}

function navHtml(site: { name: string; description: string }, pages: { url: string; title: string }[], here: string, up: string): string {
  const items = pages.map((p) => `<li${p.url === here ? ' class="here"' : ''}><a href="${up}${mdUrl(p.url)}">${esc(p.title)}</a></li>`).join('');
  return `<nav class="side" aria-label="Pages"><p class="name"><a href="${up}index.html">${esc(site.name)}</a></p>${site.description ? `<p class="about">${esc(site.description)}</p>` : ''}<ul>${items}</ul><p class="search-link"><a href="${up}search.html">Search</a></p></nav>`;
}

function pageShell(o: { siteName: string; title: string; description: string; accent: string; up: string; nav: string; body: string }): string {
  const full = o.title === o.siteName ? o.siteName : `${o.title} · ${o.siteName}`;
  return `<!doctype html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(full)}</title>
${o.description ? `<meta name="description" content="${esc(o.description)}">\n<meta property="og:title" content="${esc(full)}">\n<meta property="og:description" content="${esc(o.description)}">\n<meta property="og:type" content="article">\n` : ''}<link rel="stylesheet" href="${o.up}style.css">
<style>:root{--accent:${esc(o.accent)}}</style>
</head>
<body>
<div class="wrap">${o.nav}<main>${o.body}<footer class="site">Published from the Vault.</footer></main></div>
</body>
</html>
`;
}

/** Properties never published (privacy and machinery, never content). */
const HIDDEN_PROPS = new Set(['sensitivity', 'publish', 'private', 'visibility', 'neuralvault-speaker-names']);

const propWords = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.map(propWords).filter(Boolean).join(', ');
  if (typeof v === 'object') return '';
  return String(v);
};

const capKey = (k: string): string => k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/** A page's visible properties as a quiet list (hidden ones and the never-published four stay out). */
export function propsHtml(props: Record<string, unknown>): string {
  const rows = Object.entries(props ?? {})
    .filter(([k]) => !HIDDEN_PROPS.has(k.trim().toLowerCase()))
    .map(([k, v]) => ({ k: capKey(k.trim()), v: propWords(v).trim().slice(0, 300) }))
    .filter((r) => r.k && r.v);
  if (!rows.length) return '';
  return `<ul class="props">${rows.map((r) => `<li><b>${esc(r.k)}</b> ${esc(r.v)}</li>`).join('')}</ul>`;
}

const FRONTMATTER = /^\uFEFF?---[ \t]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;

/** A page's first paragraph in plain words (its sharing description). */
export function pageDescription(html: string): string {
  const p = /<p>([\s\S]*?)<\/p>/.exec(html)?.[1] ?? '';
  return p
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

const textOf = (html: string): string =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

export interface BuildInput {
  site: { name: string; description: string; accent: string };
  /** The notes to publish (resolved, in site order). */
  pages: { path: string; title: string; props: Record<string, unknown>; text: string; mtime?: number }[];
  vault: SiteVault;
  /** The person's Properties choice (Settings › General › A note's properties): Hidden publishes none. */
  showProperties: boolean;
}

export interface BuiltFile {
  /** The address in the site ('index.html', 'notes/icing.html', 'files/cake.png'). */
  path: string;
  data: Uint8Array;
}

export interface BuiltSite {
  files: BuiltFile[];
  pages: { path: string; title: string; url: string }[];
  attachments: string[];
  warnings: string[];
}

/** The whole site, built: home, one page per note, search, styles, and the files the notes use. */
export function buildSite(input: BuildInput): BuiltSite {
  const site = { name: input.site.name.trim() || 'Published notes', description: input.site.description.trim(), accent: cleanAccent(input.site.accent) };
  const files: BuiltFile[] = [];
  const warnings: string[] = [];
  const taken = new Set<string>(['index.html', 'search.html']);
  const urls = new Map<string, string>();
  const pages = input.pages.map((p) => {
    const url = pageUrlFor(cleanRel(p.path), taken);
    urls.set(cleanRel(p.path).replace(/\.md$/i, '').toLowerCase(), url);
    return { ...p, url };
  });
  // Attachments: each vault file once, under a web-safe name.
  const wanted = new Map<string, { url: string; data: Uint8Array; source: string }>();
  const fileNames = new Set<string>();
  const wantFile = (rel: string): string | null => {
    const clean = cleanRel(rel);
    if (isPrivatePath(clean) || isOwn(clean)) return null;
    const hit = wanted.get(clean.toLowerCase());
    if (hit) return hit.url;
    if (wanted.size >= SITE_LIMITS.attachments) {
      warnings.push('Some files were left out: one site holds 2,000 files.');
      return null;
    }
    const data = input.vault.read(clean);
    if (!data) return null;
    if (data.length > SITE_LIMITS.attachment) {
      warnings.push(`${baseOf(clean)} is larger than 25 MB, so it was left out.`);
      return null;
    }
    const ext = /\.[a-z0-9]{1,8}$/i.exec(baseOf(clean))?.[0].toLowerCase() ?? '';
    const stem = slug(baseOf(clean).replace(/\.[^.]+$/, '')) || 'file';
    let url = `files/${stem}${ext}`;
    let k = 2;
    while (fileNames.has(url)) url = `files/${stem}-${k++}${ext}`;
    fileNames.add(url);
    wanted.set(clean.toLowerCase(), { url, data, source: clean });
    return url;
  };
  const rendered: SitePage[] = [];
  for (const p of pages) {
    if (new TextEncoder().encode(p.text).length > SITE_LIMITS.note) {
      warnings.push(`“${p.title}” is larger than 2 MB, so it was left out.`);
      continue;
    }
    // Secrets and private notes out first (src/shared/share.ts): a shared copy must never leak one.
    const resolve = { resolve: (t: string) => input.vault.resolve(t, cleanRel(p.path)) ?? t };
    const noFm = String(p.text ?? '').replace(FRONTMATTER, '');
    const clean = withoutPrivate(withoutSecrets(noFm), resolve).replace(/^\s*\n/, '');
    const ready = rewriteLinks(clean, { from: cleanRel(p.path), url: p.url, urls, wantFile }, input.vault);
    const html = renderSiteBody(ready);
    const startsWithTitle = /^\s*<h1[ >]/.test(html);
    const props = input.showProperties ? propsHtml(p.props ?? {}) : '';
    // Properties under the title (after the note's own # heading when it has one).
    const body = startsWithTitle ? html.replace(/<\/h1>/, `</h1>\n${props}`) : `<h1>${esc(p.title)}</h1>\n${props}${html}`;
    rendered.push({ url: p.url, title: p.title, html: body, text: textOf(html).slice(0, 4000), description: pageDescription(html), mtime: typeof p.mtime === 'number' ? p.mtime : 0, image: firstCardImage(html, p.url) });
  }
  const nav = rendered.map((p) => ({ url: p.url, title: p.title }));
  for (const p of rendered) {
    const depth = p.url.split('/').length - 1;
    const up = depth ? '../'.repeat(depth) : '';
    files.push({ path: p.url, data: new TextEncoder().encode(pageShell({ siteName: site.name, title: p.title, description: p.description, accent: site.accent, up, nav: navHtml(site, nav, p.url, up), body: p.html })) });
  }
  // The home page (round 2): the site's name and description as a calm header, the pages as cards (most recently
  // changed first; the sort is stable, so pages without a time keep the site's order), each with its first line and
  // its first picture when it has one. The picture is decorative beside the card's own words (alt=""), loaded lazily.
  const fresh = [...rendered].sort((a, b) => b.mtime - a.mtime);
  const cards = fresh
    .map((p) => `<li class="home-card"><a href="${mdUrl(p.url)}">${p.image ? `<span class="home-card-img"><img src="${EXTERNAL.test(p.image) ? esc(p.image) : mdUrl(p.image)}" alt="" loading="lazy" decoding="async"></span>` : ''}<span class="home-card-words"><span class="home-card-title">${esc(p.title)}</span>${p.description ? `<span class="home-card-first">${esc(p.description.slice(0, 200))}</span>` : ''}</span></a></li>`)
    .join('');
  files.push({
    path: 'index.html',
    data: new TextEncoder().encode(
      pageShell({ siteName: site.name, title: site.name, description: site.description, accent: site.accent, up: '', nav: navHtml(site, nav, 'index.html', ''), body: `<header class="home-head"><h1>${esc(site.name)}</h1>${site.description ? `\n<p>${esc(site.description)}</p>` : ''}</header>\n${cards ? `<ul class="home-cards">${cards}</ul>` : '<p class="home-empty">Nothing is published in this site yet.</p>'}` }),
    ),
  });
  const index = rendered.map((p) => ({ t: p.title, u: p.url, x: p.text }));
  const indexJson = JSON.stringify(index).replace(/</g, '\\u003c');
  files.push({
    path: 'search.html',
    data: new TextEncoder().encode(
      pageShell({
        siteName: site.name,
        title: 'Search',
        description: `Search ${site.name}.`,
        accent: site.accent,
        up: '',
        nav: navHtml(site, nav, 'search.html', ''),
        body: `<h1>Search</h1>\n<div class="search-box"><input id="q" type="search" placeholder="Search every page" aria-label="Search every page" autofocus><p id="note"></p><ol id="results"></ol></div>\n<script>window.__siteIndex=${indexJson};\n${SEARCH_JS}</script>`,
      }),
    ),
  });
  files.push({ path: 'style.css', data: new TextEncoder().encode(SITE_CSS) });
  for (const w of wanted.values()) files.push({ path: w.url, data: w.data });
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, pages: rendered.map((p) => ({ path: [...urls].find(([, u]) => u === p.url)?.[0] ?? '', title: p.title, url: p.url })), attachments: [...wanted.values()].map((w) => w.source), warnings: [...new Set(warnings)] };
}

// ── Re-publish: only what changed is written, pages no longer chosen are removed ────────────────────────────────────

/** A short fingerprint (FNV-1a, pure: no Node, so the renderer builds it too), for change detection. */
export function fingerprint(data: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) {
    h ^= data[i]!;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export interface SiteManifest {
  [path: string]: string;
}

export function manifestOf(files: BuiltFile[]): SiteManifest {
  return Object.fromEntries(files.map((f) => [f.path, fingerprint(f.data)]));
}

/** What a re-publish writes and removes (compared against the last publish's manifest). */
export function planSiteWrite(prev: SiteManifest, next: BuiltFile[]): { write: string[]; remove: string[]; same: boolean } {
  const now = manifestOf(next);
  const write = next.filter((f) => prev[f.path] !== now[f.path]).map((f) => f.path);
  const keep = new Set(next.map((f) => f.path));
  const remove = Object.keys(prev).filter((p) => !keep.has(p));
  return { write, remove, same: write.length === 0 && remove.length === 0 };
}

// ── The person's sites (.neuralvault/sites.json: name, what is in it, where it goes, last published) ────────────────

const SITE_ID = /^[A-Za-z0-9_-]{6,40}$/;
export function newSiteId(): string {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  const rnd = (n: number): number => Math.floor(Math.random() * n);
  for (let i = 0; i < 12; i++) id += abc[rnd(abc.length)];
  return `s${id}`;
}

function cleanSource(v: unknown): SiteSource | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (o.kind === 'page' && typeof o.path === 'string' && cleanRel(o.path)) return { kind: 'page', path: cleanRel(o.path) };
  if (o.kind === 'project' && typeof o.path === 'string' && cleanRel(o.path)) return { kind: 'project', path: cleanRel(o.path) };
  if (o.kind === 'folder' && typeof o.folder === 'string') return { kind: 'folder', folder: cleanRel(o.folder) };
  if (o.kind === 'tag' && typeof o.tag === 'string' && o.tag.trim()) return { kind: 'tag', tag: o.tag.trim().replace(/^#/, '').slice(0, 80) };
  if (o.kind === 'list' && Array.isArray(o.paths)) {
    const paths = [...new Set(o.paths.filter((p): p is string => typeof p === 'string' && !!cleanRel(p)).map(cleanRel))].slice(0, SITE_LIMITS.notes);
    return { kind: 'list', paths };
  }
  return null;
}

function cleanHost(v: unknown): SiteDef['host'] {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== 'string' || !/^[a-z]{2,20}$/.test(o.id)) return null;
  return { id: o.id, settings: o.settings && typeof o.settings === 'object' && !Array.isArray(o.settings) ? (o.settings as Record<string, unknown>) : {} };
}

function cleanSite(v: unknown): SiteDef | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const source = cleanSource(o.source);
  if (!source || typeof o.id !== 'string' || !SITE_ID.test(o.id)) return null;
  return {
    id: o.id,
    name: typeof o.name === 'string' && o.name.trim() ? o.name.trim().slice(0, 80) : 'Published notes',
    description: typeof o.description === 'string' ? o.description.trim().slice(0, 300) : '',
    source,
    folder: typeof o.folder === 'string' ? o.folder.slice(0, 1024) : '',
    accent: cleanAccent(o.accent),
    host: cleanHost(o.host),
    createdAt: typeof o.createdAt === 'string' ? o.createdAt.slice(0, 30) : '',
    publishedAt: typeof o.publishedAt === 'string' ? o.publishedAt.slice(0, 30) : '',
    lastWords: typeof o.lastWords === 'string' ? o.lastWords.slice(0, 500) : '',
  };
}

/** The sites file read leniently: anything it doesn't understand is left out, never an error. */
export function parseSites(raw: unknown): SiteDef[] {
  let v: unknown = raw;
  if (typeof raw === 'string') {
    try {
      v = JSON.parse(raw.replace(/^\uFEFF/, ''));
    } catch {
      return [];
    }
  }
  if (!v || typeof v !== 'object') return [];
  const list = (v as { sites?: unknown }).sites;
  if (!Array.isArray(list)) return [];
  return list.map(cleanSite).filter((s): s is SiteDef => !!s).slice(0, 50);
}

export function writeSites(sites: SiteDef[]): string {
  return `${JSON.stringify({ version: 1, sites: sites.filter((s) => cleanSite(s)).slice(0, 50) }, null, 1)}\n`;
}

/** The published marks for notes: each included path → the sites that publish it. */
export function siteMarks(sites: SiteDef[], resolved: Map<string, string[]>): { path: string; sites: { id: string; name: string }[] }[] {
  const byId = new Map(sites.map((s) => [s.id, s]));
  const out = new Map<string, { id: string; name: string }[]>();
  for (const [id, paths] of resolved) {
    const s = byId.get(id);
    if (!s || !s.publishedAt) continue;
    for (const p of paths) {
      const list = out.get(p) ?? [];
      list.push({ id: s.id, name: s.name });
      out.set(p, list);
    }
  }
  return [...out].map(([path, list]) => ({ path, sites: list })).sort((a, b) => a.path.localeCompare(b.path));
}

