// The side chat on the web (8.0 V6, 28 Oct 2026; the audit: "look up the warranty period for a Bosch dishwasher and add
// it to my appliance" meant handing the whole job to the former host app). It searches with the former host app's own
// free search (the host's webSearch: The former host app's browser on this PC, never a paid relay or a key) and reads a
// page it found as words. A page is fetched plainly (no sign-in, no cookies), only on the open web: never this PC, a
// local network or a non-web address. What a page says is information, never instructions.

export interface WebHit {
  title: string;
  url: string;
  snippet: string;
}

const PAGE_CHARS = 12_000;
const MAX_BYTES = 3_000_000;
const PRIVATE_HOST = /^(?:localhost|.*\.local|.*\.internal|0\.0\.0\.0|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+|\[?::1\]?|\[?f[cd][0-9a-f]{2}:.*)$/i;

/** A web address that may be read: http(s) on the open web; else why not. */
export function webAddress(raw: unknown): URL {
  let url: URL;
  try {
    url = new URL(String(raw ?? '').trim());
  } catch {
    throw new Error('That isn’t a web address. Give the whole address, starting https://.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Only web pages (https://…) are read.');
  if (PRIVATE_HOST.test(url.hostname)) throw new Error('Only pages on the open web are read, never this PC or a local network.');
  return url;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[e.toLowerCase()] ?? whole;
  });

/** A page's readable words: its title, then its text (scripts, styles, navigation and footers left out). */
export function pageWords(html: string): { title: string; text: string } {
  const title = decode((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '').replace(/\s+/g, ' ').trim());
  const main = /<(main|article)\b[\s\S]*?<\/\1>/i.exec(html)?.[0] ?? html;
  const text = decode(
    main
      .replace(/<(script|style|noscript|svg|nav|footer|header|form|iframe)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6]|tr|section|article|table)>/gi, '\n')
      .replace(/<li\b[^>]*>/gi, '- ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t\f\v ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { title, text };
}

/** Reads a page as words (at most about 12,000 characters). */
export async function readPage(raw: unknown, fetchImpl: typeof fetch = fetch): Promise<{ url: string; title: string; text: string; cut: boolean }> {
  const url = webAddress(raw);
  const r = await fetchImpl(url.href, { redirect: 'follow', signal: AbortSignal.timeout(20_000), headers: { accept: 'text/html,text/plain;q=0.9,*/*;q=0.5', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Ironleaf' } }).catch(() => null);
  if (!r) throw new Error(`${url.hostname} couldn’t be reached just now.`);
  if (r.url) webAddress(r.url);
  if (!r.ok) throw new Error(`${url.hostname} answered ${r.status}: the page couldn’t be read.`);
  const type = r.headers.get('content-type') ?? '';
  if (!/text\/html|text\/plain|application\/xhtml/i.test(type)) throw new Error('That address is a file, not a page.');
  const body = (await r.text()).slice(0, MAX_BYTES);
  const { title, text } = /text\/plain/i.test(type) ? { title: '', text: body.trim() } : pageWords(body);
  return { url: r.url || url.href, title, text: text.slice(0, PAGE_CHARS), cut: text.length > PAGE_CHARS };
}

/** Search results as the host gives them, checked. */
export function cleanHits(raw: unknown): WebHit[] {
  const list = Array.isArray((raw as { results?: unknown })?.results) ? (raw as { results: unknown[] }).results : Array.isArray(raw) ? raw : [];
  return list
    .map((x) => x as Partial<WebHit>)
    .filter((x) => typeof x?.url === 'string' && /^https?:\/\//i.test(x.url))
    .slice(0, 10)
    .map((x) => ({ title: String(x.title ?? '').slice(0, 200), url: String(x.url).slice(0, 1000), snippet: String(x.snippet ?? '').slice(0, 400) }));
}
