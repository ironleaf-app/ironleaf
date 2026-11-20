// The web clipper's shared half (8.8, 31 Oct 2026: rival apps "have a much higher feature list than us"): what the
// browser extension sends and what a clip becomes, as plain functions the local endpoint (src/main/clipper.ts)
// runs and the tests check (tests/clipper-extract.test.mjs, tests/clipper-server.test.mjs).
//
//   extractArticle  a page's HTML as a clean article: title, author, date, site, markdown, its pictures' addresses
//   extractSelection  the part marked on the page, as markdown
//   cleanClip     a clip request checked (plain words when it is wrong)
//   clipNoteText  the Vault note: its source link in front matter, the words, its pictures kept beside it
//
// Pure: no Node modules (the extension's popup words and these checks share them one day).

import { cleanTag } from './tags';

/** Where the running Vault listens for its own browser extension: the first free one, tried in order. */
export const CLIPPER_PORTS = [28741, 28742, 28743];
/** The paired extension proves itself on every request with this header (a web page can neither read nor send it). */
export const CLIPPER_TOKEN_HEADER = 'x-neuralvault-clipper';
/** Clips land here unless the person picks a folder or a project. */
export const CLIPPER_DEFAULT_FOLDER = 'Clippings';
/** A page's HTML at most this long is read (4 MB: pages longer than this carry the article long before the end). */
export const CLIPPER_HTML_MAX = 4 * 1024 * 1024;
/** A clip's pictures: at most 30, each at most 8 MB. */
export const CLIPPER_IMAGES_MAX = 30;
export const CLIPPER_IMAGE_MAX = 8 * 1024 * 1024;
/** A clip's words at most this long (about a long article). */
export const CLIPPER_TEXT_MAX = 200_000;

export type ClipKind = 'article' | 'selection' | 'bookmark' | 'screenshot';

/** A picture the extension fetched from the page (the Vault never fetches page addresses itself). */
export interface ClipImage {
  /** The picture's address on the page, absolute. */
  url: string;
  /** Its bytes, base64 (a data: address sent whole is read too). */
  data: string;
  /** image/png, image/jpeg, image/gif, image/webp. */
  type: string;
}

export interface ClipPlace {
  kind: 'folder' | 'project';
  path: string;
}

/** A clip as the extension sends it. */
export interface ClipRequest {
  kind: ClipKind;
  /** The page's address. */
  url: string;
  /** The page's title. */
  title: string;
  /** The page's HTML (article), or the marked part's HTML (selection). */
  html?: string;
  /** The marked part as plain words (selection, when its HTML is missing). */
  text?: string;
  /** The page's own summary (bookmark). */
  description?: string;
  author?: string;
  published?: string;
  site?: string;
  /** The pictures fetched from the page (article, selection, bookmark). */
  images?: ClipImage[];
  /** The visible page as a picture (screenshot). */
  screenshot?: ClipImage;
  /** Where it lands (null: Clippings). */
  place?: ClipPlace | null;
  tags?: string[];
  /** The person's own note on the clip. */
  note?: string;
}

// ——— The pairing code ————————————————————————————————————————————————————————————————————————————————————————————

/** The code's letters: nothing easily mixed up (no I, L, O, 0 or 1). */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 8;

/** A code as typed (small letters, spaces and dashes allowed) as kept: 8 capital letters and digits. */
export function cleanCode(raw: unknown): string {
  return String(raw ?? '').toUpperCase().replace(/[\s-]+/g, '');
}

/** Whether a kept code could be one the Vault gave (8 letters and digits from its alphabet). */
export function codeValid(code: string): boolean {
  return code.length === CODE_LENGTH && [...code].every((c) => CODE_ALPHABET.includes(c));
}

/** A kept code as shown and typed: two groups of four ("K7M2 Q9XD"). */
export function codeWords(code: string): string {
  return code.length === CODE_LENGTH ? `${code.slice(0, 4)} ${code.slice(4)}` : code;
}

// ——— A clip request, checked ————————————————————————————————————————————————————————————————————————————————————

const httpUrl = (raw: unknown, what: string): string => {
  const url = String(raw ?? '').trim().slice(0, 2000);
  if (!/^https?:\/\//i.test(url)) throw new Error(`${what} is not a web address. Clip from the page itself.`);
  return url;
};

const cleanImage = (raw: unknown, what: string): ClipImage => {
  const img = (raw && typeof raw === 'object' ? raw : {}) as Partial<ClipImage>;
  const url = String(img.url ?? '').trim().slice(0, 2000);
  if (url && !/^https?:\/\//i.test(url) && !url.startsWith('data:image/')) throw new Error(`${what}’s address is not a web address.`);
  const type = String(img.type ?? '').trim().toLowerCase().slice(0, 40);
  if (!/^image\/(png|jpe?g|gif|webp)$/.test(type)) throw new Error(`${what} is not a picture the Vault keeps (PNG, JPEG, GIF or WebP).`);
  let data = String(img.data ?? '');
  const at = data.indexOf('base64,');
  if (data.startsWith('data:') && at >= 0) data = data.slice(at + 7);
  data = data.replace(/\s+/g, '');
  if (!data || data.length > Math.ceil((CLIPPER_IMAGE_MAX * 4) / 3) + 8 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new Error(`${what}’s picture is too large or could not be read.`);
  return { url, data, type };
};

/** A clip request checked and trimmed: plain words when it is wrong, never a crash on a strange shape. */
export function cleanClip(raw: unknown): ClipRequest {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const kind = r.kind as ClipKind;
  if (kind !== 'article' && kind !== 'selection' && kind !== 'bookmark' && kind !== 'screenshot') throw new Error('That clip has no kind the Vault knows (article, selection, bookmark or screenshot).');
  const url = httpUrl(r.url, 'The page');
  const clip: ClipRequest = { kind, url, title: String(r.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 300) };
  if (r.html !== undefined) clip.html = String(r.html ?? '').slice(0, CLIPPER_HTML_MAX);
  if (r.text !== undefined) clip.text = String(r.text ?? '').slice(0, CLIPPER_TEXT_MAX);
  if (r.description !== undefined) clip.description = String(r.description ?? '').replace(/\s+/g, ' ').trim().slice(0, 2000);
  for (const key of ['author', 'published', 'site'] as const) {
    if (r[key] !== undefined && String(r[key] ?? '').trim()) clip[key] = String(r[key]).replace(/\s+/g, ' ').trim().slice(0, 300);
  }
  if (r.images !== undefined) {
    if (!Array.isArray(r.images)) throw new Error('The clip’s pictures are not a list.');
    if (r.images.length > CLIPPER_IMAGES_MAX) throw new Error(`A clip keeps at most ${CLIPPER_IMAGES_MAX} pictures.`);
    clip.images = r.images.map((img, i) => cleanImage(img, `Picture ${i + 1}`));
  }
  if (r.screenshot !== undefined) clip.screenshot = cleanImage(r.screenshot, 'The screenshot');
  if (r.place !== undefined && r.place !== null) {
    const p = r.place as Partial<ClipPlace>;
    if (!p || typeof p !== 'object' || (p.kind !== 'folder' && p.kind !== 'project') || typeof p.path !== 'string' || !p.path.trim() || p.path.length > 400) {
      throw new Error('That folder or project is not one the Vault has. Pick another.');
    }
    clip.place = { kind: p.kind, path: p.path.trim() };
  } else clip.place = null;
  if (r.tags !== undefined) {
    const list = Array.isArray(r.tags) ? r.tags : String(r.tags ?? '').split(',');
    clip.tags = [...new Set(list.map((t) => cleanTag(String(t ?? ''))).filter((t): t is string => !!t))].slice(0, 20);
  }
  if (r.note !== undefined && String(r.note ?? '').trim()) clip.note = String(r.note ?? '').replace(/\r\n/g, '\n').trim().slice(0, 20000);
  if (kind === 'screenshot' && !clip.screenshot) throw new Error('The screenshot did not come through. Try again.');
  if ((kind === 'article' || kind === 'selection') && !clip.html?.trim() && !clip.text?.trim()) throw new Error('The page came through empty. Try again on the page itself.');
  return clip;
}

// ——— Reading a page —————————————————————————————————————————————————————————————————————————————————————————————

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', copy: '©', reg: '®', trade: '™', times: '×', divide: '÷' };
export const decodeEntities = (s: string): string =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[e.toLowerCase()] ?? whole;
  });

/** An address on a page as an absolute one (images, links); '' when it is not a page address at all. */
export function absoluteUrl(raw: string, page: string): string {
  const href = String(raw ?? '').trim();
  if (!href || /^(data|javascript|mailto|tel|blob):/i.test(href)) return '';
  if (/^https?:\/\//i.test(href)) return href;
  try {
    return new URL(href, page).href;
  } catch {
    return '';
  }
}

const metaContent = (html: string, attr: string, name: string): string => {
  const re = new RegExp(`<meta\\b[^>]*?${attr}=["']${name}["'][^>]*?>`, 'gi');
  for (const m of html.matchAll(re)) {
    const c = /content=(["'])([\s\S]*?)\1/i.exec(m[0])?.[2];
    if (c?.trim()) return decodeEntities(c.trim());
  }
  return '';
};

interface PageMeta {
  title: string;
  description: string;
  image: string;
  author: string;
  published: string;
  site: string;
}

/** A page's own facts: its head's title and meta, and its JSON-LD blocks when they say more (author, date). */
export function pageMeta(html: string, page: string): PageMeta {
  const head = /<head\b[\s\S]*?<\/head>/i.exec(html)?.[0] ?? html.slice(0, 50000);
  const titleTag = decodeEntities((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1] ?? '').replace(/\s+/g, ' ').trim());
  const meta: PageMeta = {
    title: metaContent(head, 'property', 'og:title') || titleTag,
    description: metaContent(head, 'property', 'og:description') || metaContent(head, 'name', 'description'),
    image: '',
    author: metaContent(head, 'property', 'article:author') || metaContent(head, 'name', 'author'),
    published: metaContent(head, 'property', 'article:published_time') || metaContent(head, 'name', 'date') || metaContent(head, 'itemprop', 'datePublished'),
    site: metaContent(head, 'property', 'og:site_name'),
  };
  const ogImage = metaContent(head, 'property', 'og:image');
  if (ogImage) meta.image = absoluteUrl(ogImage, page);
  // JSON-LD (recipes, news): another author or date when the meta tags say none.
  if (!meta.author || !meta.published || !meta.title) {
    for (const m of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
      let docs: unknown[];
      try {
        const parsed: unknown = JSON.parse(m[1]);
        docs = Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        continue;
      }
      const flat: Record<string, unknown>[] = [];
      const walk = (d: unknown): void => {
        if (!d || typeof d !== 'object') return;
        if (Array.isArray(d)) return void d.forEach(walk);
        flat.push(d as Record<string, unknown>);
        const g = (d as Record<string, unknown>)['@graph'];
        if (Array.isArray(g)) g.forEach(walk);
      };
      docs.forEach(walk);
      for (const d of flat) {
        const type = String((d['@type'] ?? '') as string).toLowerCase();
        if (!/(article|news|blog|recipe|report|webpage)/.test(type)) continue;
        if (!meta.author && d.author) {
          const a = Array.isArray(d.author) ? d.author[0] : d.author;
          const name = typeof a === 'string' ? a : (a as Record<string, unknown>)?.name;
          if (typeof name === 'string' && name.trim()) meta.author = name.trim().slice(0, 200);
        }
        if (!meta.published && typeof d.datePublished === 'string' && d.datePublished.trim()) meta.published = d.datePublished.trim().slice(0, 100);
        if (!meta.title && typeof d.headline === 'string' && d.headline.trim()) meta.title = decodeEntities(d.headline.trim()).slice(0, 300);
        if (!meta.title && typeof d.name === 'string' && /recipe/.test(type) && d.name.trim()) meta.title = decodeEntities(d.name.trim()).slice(0, 300);
      }
      if (meta.author && meta.published && meta.title) break;
    }
  }
  if (!meta.site) {
    try {
      meta.site = new URL(page).hostname.replace(/^www\./, '');
    } catch {
      meta.site = '';
    }
  }
  return meta;
}

/** The part of a page worth keeping: its article, else its main content, else the page (menus and footers left out). */
function articleHtml(html: string): string {
  const cut = (tag: string): string | null => {
    const m = new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}>`, 'i').exec(html);
    return m ? m[0] : null;
  };
  const main = /<([a-z][a-z0-9]*)\b[^>]*\brole=["']main["'][^>]*>([\s\S]*?)<\/\1>/i.exec(html)?.[0];
  return cut('article') ?? cut('main') ?? main ?? /<body\b[\s\S]*<\/body>/i.exec(html)?.[0] ?? html;
}

/** Marks, scripts, menus and side content gone; lists and tables kept as lines the markdown step reads. */
function stripToText(html: string): string {
  let s = html.replace(/<!--[\s\S]*?-->/g, ' ');
  // Hidden content is never the article (structural hiding only, never a word list).
  s = s.replace(/<([a-z][a-z0-9]*)\b[^>]*?(?:\bhidden\b|style=["'][^"']*?display\s*:\s*none[^"']*?["'])[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  for (const tag of ['script', 'style', 'noscript', 'svg', 'nav', 'footer', 'header', 'form', 'iframe', 'canvas', 'aside', 'button', 'select', 'input', 'textarea', 'audio', 'video']) {
    s = s.replace(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}>`, 'gi'), ' ').replace(new RegExp(`<${tag}\\b[^>]*\\/>`, 'gi'), ' ');
  }
  return s;
}

export interface ArticleMarkdown {
  markdown: string;
  /** The pictures the markdown points at, absolute addresses in order. */
  images: string[];
}

/** Kept HTML as markdown: headings, lists (nested kept), quotes, code, tables, links and pictures. */
export function htmlToMarkdown(html: string, page: string): ArticleMarkdown {
  const images: string[] = [];
  let s = stripToText(html);
  // Code blocks first (their < and > are words, not marks).
  const code: string[] = [];
  s = s.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_m, inner: string) => {
    code.push(decodeEntities(inner.replace(/<[^>]+>/g, '')).replace(/^\n+|\s+$/g, ''));
    return `\n\u0000CODE${code.length - 1}\u0000\n`;
  });
  // Pictures: kept as markdown with absolute addresses; the Vault saves the fetched ones locally.
  s = s.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = /src=(["'])([\s\S]*?)\1/i.exec(tag)?.[2] ?? /srcset=(["'])([\s\S]*?)\1/i.exec(tag)?.[2].split(',')[0]?.trim().split(/\s+/)[0] ?? '';
    const abs = absoluteUrl(decodeEntities(src), page);
    if (!abs) return ' ';
    const alt = decodeEntities((/alt=(["'])([\s\S]*?)\1/i.exec(tag)?.[2] ?? '').replace(/\s+/g, ' ').trim().slice(0, 200));
    images.push(abs);
    return `\n![${alt.replace(/[\[\]]/g, '')}](${abs})\n`;
  });
  // Links: kept with absolute addresses (page furniture links rarely survive the strip above).
  s = s.replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, (m, inner: string) => {
    const href = absoluteUrl(decodeEntities((/href=(["'])([\s\S]*?)\1/i.exec(m)?.[2] ?? '').trim()), page);
    const words = decodeEntities(inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
    if (!words) return ' ';
    return href ? `[${words}](${href})` : words;
  });
  s = s.replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**').replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*').replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');
  for (let h = 1; h <= 6; h++) s = s.replace(new RegExp(`<h${h}\\b[^>]*>([\\s\\S]*?)<\\/h${h}>`, 'gi'), `\n${'#'.repeat(h)} $1\n`);
  s = s.replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_m, inner: string) => `\n${inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().split('\n').map((l) => `> ${l}`).join('\n')}\n`);
  // Lists: each item on its own line with its depth, so nested lists keep their shape (one pass in document
  // order; the depth rides a marker past the whitespace collapse below, which strips line-leading spaces).
  let listDepth = 0;
  s = s.replace(/<\/?(ul|ol|li)\b[^>]*>/gi, (tag) => {
    if (/^<\/(ul|ol)/i.test(tag)) {
      listDepth = Math.max(listDepth - 1, 0);
      return '\n';
    }
    if (/^<(ul|ol)/i.test(tag)) {
      listDepth = Math.min(listDepth + 1, 6);
      return '\n';
    }
    if (/^<\//.test(tag)) return '';
    return `\n@@NVLI${Math.min(Math.max(listDepth, 1), 6)}@@- `;
  });
  // Tables: each row one line, cells joined (the first row reads as the header).
  s = s.replace(/<table\b[^>]*>([\s\S]*?)<\/table>/gi, (_m, inner: string) => {
    const rows = [...inner.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((r) => [...r[1].matchAll(/<(t[dh])\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => decodeEntities(c[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())));
    if (!rows.length) return ' ';
    const head: string[] = rows[0].length ? [`| ${rows[0].join(' | ')} |`, `| ${rows[0].map(() => '---').join(' | ')} |`] : [];
    return `\n${[...head, ...rows.slice(1).map((r) => `| ${r.join(' | ')} |`)].join('\n')}\n`;
  });
  s = s.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h[1-6]|tr|section|article|table|figure|figcaption)>/gi, '\n').replace(/<hr\b[^>]*>/gi, '\n---\n');
  s = s.replace(/<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/gi, '\n*$1*\n');
  s = s.replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s);
  s = s
    .replace(/[ \t\f\v ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  s = s.replace(/@@NVLI(\d)@@- /g, (_m, d: string) => `${'  '.repeat(Math.max(Number(d) - 1, 0))}- `);
  s = s.replace(/\u0000CODE(\d+)\u0000/g, (_m, i: string) => `\n\`\`\`\n${code[Number(i)] ?? ''}\n\`\`\`\n`).replace(/\n{3,}/g, '\n\n').trim();
  return { markdown: s.slice(0, CLIPPER_TEXT_MAX), images: [...new Set(images)].slice(0, CLIPPER_IMAGES_MAX) };
}

export interface ExtractedArticle {
  title: string;
  author: string;
  published: string;
  site: string;
  description: string;
  image: string;
  markdown: string;
  images: string[];
}

/** A page's HTML as a clean article: its own title, author, date and site, its main words, its pictures' addresses. */
export function extractArticle(html: string, page: string): ExtractedArticle {
  const meta = pageMeta(html, page);
  const { markdown, images } = htmlToMarkdown(articleHtml(html), page);
  // The title heading repeats the note's title: the first heading goes when it says the same.
  const first = /^#{1,6}\s+(.+)$/m.exec(markdown)?.[1]?.trim().toLowerCase() ?? '';
  const title = meta.title.replace(/\s+/g, ' ').trim().slice(0, 300);
  const clean = first && title && (first === title.toLowerCase() || title.toLowerCase().startsWith(first.slice(0, 40))) ? markdown.replace(/^#{1,6}\s+.+\n?/, '').trim() : markdown;
  return { title, author: meta.author, published: meta.published, site: meta.site, description: meta.description, image: meta.image, markdown: clean, images };
}

/** The part marked on the page, as markdown (its HTML, or its plain words when that is missing). */
export function extractSelection(html: string, text: string, page: string): ArticleMarkdown {
  if (html.trim()) return htmlToMarkdown(html, page);
  return { markdown: text.replace(/\r\n/g, '\n').trim().slice(0, CLIPPER_TEXT_MAX), images: [] };
}

// ——— The Vault note —————————————————————————————————————————————————————————————————————————————————————————————

/** A clip's title as a note's name: short, nothing Windows refuses, else a dated name. */
export function clipTitle(title: string, url: string, now: Date): string {
  const cleaned = decodeEntities(title)
    .replace(/<[^>]+>/g, ' ')
    .replace(/[<>:"/\\|?*\u0000-\u001f#^[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const cut = cleaned.length > 80 ? cleaned.slice(0, 81).replace(/\s+\S*$/, '') || cleaned.slice(0, 80) : cleaned;
  const name = cut.replace(/[. ]+$/, '').trim();
  if (name) return name;
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    if (host) return `Clipped from ${host}`;
  } catch {
    // The dated name below.
  }
  const d = `${now.getDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][now.getMonth()]} ${now.getFullYear()}`;
  return `Web clip ${d}`;
}

/** "31 Oct 2026", "31 Oct 2026 14:05" (Australian order, as the vault's own captures write it). */
export function clipDay(now: Date): string {
  return `${now.getDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][now.getMonth()]} ${now.getFullYear()}`;
}
export function clipStamp(now: Date): string {
  return `${clipDay(now)} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

const PUB_MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const PUB_WORDS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A page's published date in the vault's own words ("30 Oct 2026", "30 Oct 2026 06:15"): the page's own wall time, as
 *  its byline reads it, the time kept when the page gave one. Anything not read as a date is kept as written. */
export function clipPublished(raw: string): string {
  const s = String(raw ?? '').trim().slice(0, 100);
  if (!s) return '';
  const words = (y: number, m: number, d: number, hh?: number, mm?: number): string | null => {
    if (!(y >= 1000 && y <= 9999 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
    const day = `${d} ${PUB_WORDS[m - 1]} ${y}`;
    if (hh === undefined || mm === undefined) return day;
    if (!(hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59)) return null;
    return `${day} ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  };
  const clock = (h: string, m: string, ap: string | undefined): [number, number] | null => {
    const mm = Number(m);
    if (!(mm >= 0 && mm <= 59)) return null;
    if (ap) {
      const twelve = Number(h);
      if (!(twelve >= 1 && twelve <= 12)) return null;
      return [(twelve % 12) + (/p/i.test(ap) ? 12 : 0), mm];
    }
    const hh = Number(h);
    return hh >= 0 && hh <= 23 ? [hh, mm] : null;
  };
  const monIndex = (name: string): number => PUB_MON.indexOf(name.slice(0, 3).toLowerCase()) + 1;
  // ISO: 2026-04-18, 2026-10-30T06:15[:SS][Z|±off] (article:published_time, JSON-LD datePublished).
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?\s*(?:Z|[+-]\d{2}:?\d{2})?)?$/i.exec(s);
  if (iso) return words(+iso[1], +iso[2], +iso[3], iso[4] === undefined ? undefined : +iso[4], iso[5] === undefined ? undefined : +iso[5]) ?? s;
  // RFC 2822: [Fri, ]30 Oct 2026[ 06:15[:SS][ zone]] (feeds and some pages).
  const rfc = /^(?:[A-Za-z]{3,9},\s*)?(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::\d{2})?(?:\s*(?:[+-]\d{2}:?\d{2}|[A-Za-z]{1,5}))?)?$/.exec(s);
  if (rfc) {
    const t = rfc[4] === undefined ? undefined : clock(rfc[4], rfc[5], undefined);
    if (rfc[4] !== undefined && !t) return s;
    return words(+rfc[3], monIndex(rfc[2]), +rfc[1], t?.[0], t?.[1]) ?? s;
  }
  // Written out: October 30, 2026[ 6:15am] and 30 October 2026[, 18:05].
  const monthFirst = /^([A-Za-z]{3,9})\s+(\d{1,2}),\s*(\d{4})(?:,?\s+(\d{1,2}):(\d{2})\s*([AaPp]\.?[Mm]\.?)?)?$/.exec(s);
  if (monthFirst) {
    const t = monthFirst[4] === undefined ? undefined : clock(monthFirst[4], monthFirst[5], monthFirst[6]);
    if (monthFirst[4] !== undefined && !t) return s;
    return words(+monthFirst[3], monIndex(monthFirst[1]), +monthFirst[2], t?.[0], t?.[1]) ?? s;
  }
  const dayFirst = /^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})(?:,?\s+(\d{1,2}):(\d{2})\s*([AaPp]\.?[Mm]\.?)?)?$/.exec(s);
  if (dayFirst) {
    const t = dayFirst[4] === undefined ? undefined : clock(dayFirst[4], dayFirst[5], dayFirst[6]);
    if (dayFirst[4] !== undefined && !t) return s;
    return words(+dayFirst[3], monIndex(dayFirst[2]), +dayFirst[1], t?.[0], t?.[1]) ?? s;
  }
  return s;
}

/** A picture's address as a file's name stem ("tunnel-1200", spaces kept): marks a ![[link]] cannot name ([#[]) become
 *  spaces, an address with no name is the fallback, and an odd address never breaks the clip. */
export function clipImageStem(url: string, fallback: string): string {
  if (!/^https?:\/\//i.test(String(url ?? '').trim())) return fallback;
  let last = '';
  try {
    last = decodeURIComponent(String(url).split('?')[0].split('/').filter(Boolean).pop() ?? '');
  } catch {
    last = String(url).split('?')[0].split('/').filter(Boolean).pop() ?? '';
  }
  const stem = last.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[<>:\"/\\|?*\u0000-\u001f#[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  return stem || fallback;
}

const yamlQuoted = (value: string): string => JSON.stringify(value);

/** The note's properties: its source link first, then what the page said of itself. */
export function clipFrontMatter(input: { source: string; site: string; author: string; published: string; clipped: string; tags: string[] }): string {
  const lines = ['---', `source: ${yamlQuoted(input.source)}`];
  if (input.site) lines.push(`site: ${yamlQuoted(input.site)}`);
  if (input.author) lines.push(`author: ${yamlQuoted(input.author)}`);
  if (input.published) lines.push(`published: ${yamlQuoted(input.published)}`);
  lines.push(`clipped: ${yamlQuoted(input.clipped)}`);
  if (input.tags.length) lines.push(`tags: [${input.tags.map((t) => yamlQuoted(t)).join(', ')}]`);
  lines.push('---');
  return lines.join('\n');
}

export interface ClipBodyInput {
  kind: ClipKind;
  /** The person's own note on the clip. */
  note: string;
  /** The article or selection markdown (pictures already pointed at the Vault's copies). */
  markdown: string;
  /** The page's own summary (bookmark). */
  description: string;
  /** Saved pictures, as the note embeds them. */
  embeds: string[];
  /** The page's address, title and site for the source line. */
  url: string;
  title: string;
  site: string;
  /** "31 Oct 2026". */
  day: string;
}

/** The note's words: the person's note first, then the clip, then where it came from. */
export function clipBody(input: ClipBodyInput): string {
  const parts: string[] = [];
  if (input.note) parts.push(input.note);
  if (input.kind === 'bookmark') {
    if (input.description) parts.push(input.description);
    if (input.embeds.length) parts.push(input.embeds.join('\n'));
    parts.push(`[Open the page](${input.url})`);
  } else if (input.kind === 'screenshot') {
    if (input.embeds.length) parts.push(input.embeds.join('\n'));
    parts.push(`Taken from [${input.title || input.site || 'the page'}](${input.url}) on ${input.day}.`);
  } else {
    if (input.markdown) parts.push(input.markdown);
    parts.push(`Clipped from [${input.site || input.title || 'the page'}](${input.url}) on ${input.day}.`);
  }
  return parts.join('\n\n').trim() + '\n';
}

/** The whole note: its properties, then its words. */
export function clipNoteText(frontMatter: string, body: string): string {
  return `${frontMatter}\n\n${body}`;
}

/** Markdown whose pictures point at the Vault's copies: each fetched picture embedded, the rest said plainly. */
export function localiseImages(markdown: string, saved: Map<string, string>): string {
  return markdown.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_m, alt: string, src: string) => {
    const embed = saved.get(src) ?? saved.get(decodeEntities(src));
    if (embed) return embed;
    const words = String(alt ?? '').trim();
    return words ? `*${words} (picture not fetched)*` : '*(Picture not fetched)*';
  });
}

/** A clipped note without its properties (for comparing words, not when it was clipped). */
export function stripClipFront(note: string): string {
  if (!note.startsWith('---')) return note;
  const end = note.indexOf('\n---', 3);
  if (end < 0) return note;
  const after = note.indexOf('\n', end + 4);
  return after < 0 ? '' : note.slice(after + 1);
}

/** Whether a line carries words to compare (not a picture, a source line or nothing). */
function clipContentLine(line: string): string | null {
  const t = line.trim().replace(/\s+/g, ' ');
  if (!t) return null;
  if (/^!\[.*\]\(.*\)$/.test(t) || /^!\[\[.*\]\]$/.test(t)) return null;
  if (/^\*.*picture not fetched.*\*$/.test(t)) return null;
  if (/^Clipped from \[.*\]\(.*\) on .+\.$/.test(t)) return null;
  if (/^\[Open the page\]\(.*\)$/.test(t)) return null;
  if (/^Taken from \[.*\]\(.*\) on .+\.$/.test(t)) return null;
  return t;
}

/**
 * Whether fresh clip words hold lines the kept note does not (10.0 item 16): pictures and
 * source lines aside, since kept pictures point at Vault copies and fresh at page addresses.
 */
export function clipHasNewLines(keptNote: string, freshText: string): boolean {
  const have = new Set(stripClipFront(keptNote).split('\n').map(clipContentLine).filter((l): l is string => !!l));
  return freshText
    .split('\n')
    .map(clipContentLine)
    .filter((l): l is string => !!l)
    .some((l) => !have.has(l));
}

/** An address for comparing: the host lower-cased, trackers and fragments off, one trailing slash off. Unreadable back as written. */
export function canonicalClipUrl(url: string): string {
  try {
    const u = new URL(String(url ?? '').trim());
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$|msclkid$)/i.test(k)) u.searchParams.delete(k);
    u.hash = '';
    const params = [...u.searchParams.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const sorted = new URLSearchParams(params);
    u.search = [...sorted.keys()].length ? `?${sorted}` : '';
    const path = u.pathname.length > 1 ? u.pathname.replace(/\/+$/, '') : u.pathname;
    return `${u.origin}${path}${u.search}`;
  } catch {
    return String(url ?? '');
  }
}
