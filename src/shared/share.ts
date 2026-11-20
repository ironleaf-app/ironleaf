// Share a page (8.8, 31 Oct 2026; the gap analysis: "Sharing/collaboration: read-only share link + realtime co-edit vs
// Notion/OneNote"). The former host app is local-first (no servers of ours holding people's notes), so a page shares as
// a clean copy, never a live link: Save as PDF, Copy as formatted text, Save as Markdown (a zip with its attachments
// when it has any) and Email it (the person's mail program with the PDF attached, never sent by itself). Private notes
// and Secrets never appear in a shared copy: a linked secret shows as "(a secret, not shared)", a private embed is
// dropped and a private link shows as "(a private note, not shared)". Pure: it makes words (Markdown, HTML, a mail
// draft); nothing here touches files. The caller says what a link target resolves to (`resolve`) and where a vault file
// is (`url`).

import { cleanHex, type BrandKit } from './assets';
import { linkWords } from './markdown';
import { withSpeakerNames } from './meeting-speakers';
import { isPrivatePath } from './private';

/** What a linked secret shows as in a shared copy. The secret's value and id never travel with it. */
export const SECRET_STANDIN = '(a secret, not shared)';
/** What a link to a private note shows as: neither its words nor its name travel with the copy. */
export const PRIVATE_STANDIN = '(a private note, not shared)';

/** A private note itself is never shareable (a page kept in the encrypted store stays there). */
export const isShareablePath = (rel: string | undefined | null): boolean => !isPrivatePath(rel);

export interface ShareResolve {
  /** A link's target as written → the vault path it names (for the privacy check); plain targets pass through. */
  resolve?: (target: string) => string;
  /** The owner's name: a meeting's mic reads as them, as on every other door (18 Nov 2026, t301 round 2). */
  me?: string;
}

const SECRET_MD = /!?\[([^\]\n]{0,80})\]\(secret:[A-Za-z0-9_-]{6,40}\)/g;

/** Secret links out, the stand-in in their place. Everywhere, including code: a shared copy must never leak one. */
export function withoutSecrets(md: string): string {
  return String(md ?? '').replace(SECRET_MD, SECRET_STANDIN);
}

const safeDecode = (s: string): string => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** A [[link]]'s target without its #heading or |alias. */
const wikiTarget = (inner: string): { target: string; alias: string } => {
  const pipe = inner.indexOf('|');
  const alias = pipe >= 0 ? inner.slice(pipe + 1).trim() : '';
  const rest = (pipe >= 0 ? inner.slice(0, pipe) : inner).trim();
  const hash = rest.indexOf('#');
  return { target: (hash >= 0 ? rest.slice(0, hash) : rest).trim(), alias };
};

const baseName = (target: string): string => safeDecode(target).replace(/\\/g, '/').replace(/^\.\//, '').split('/').pop()!.replace(/\.md$/i, '').replace(/_/g, ' ').trim() || 'Note';

/** Whether a link target names something private: a secret, or a note in the encrypted store. */
const isPrivateTarget = (target: string, resolve: (t: string) => string): boolean => {
  const t = safeDecode(target).trim();
  if (/^secret:/i.test(t)) return true;
  if (/^(https?:|mailto:|data:|#)/i.test(t)) return false;
  return isPrivatePath(resolve(t)) || isPrivatePath(t.replace(/^\.\//, ''));
};

/**
 * Private notes out of a shared copy: an embed of one is dropped (no hole left), a link to one becomes the private
 * stand-in (its name stays private too). Ordinary links and embeds stay as written.
 */
export function withoutPrivate(md: string, o: ShareResolve = {}): string {
  const resolve = o.resolve ?? ((t: string) => t);
  let out = String(md ?? '');
  out = out.replace(/!\[\[([^\[\]\n]+?)\]\]/g, (all, inner: string) => (isPrivateTarget(wikiTarget(inner).target, resolve) ? '' : all));
  out = out.replace(/\[\[([^\[\]\n]+?)\]\]/g, (all, inner: string) => (isPrivateTarget(wikiTarget(inner).target, resolve) ? PRIVATE_STANDIN : all));
  out = out.replace(/(!?)\[([^\]\n]*)\]\(\s*(<[^>\n]+>|[^)\s]+)(?:\s+"[^"]*")?\s*\)/g, (all, bang: string, _label: string, href: string) => {
    const target = safeDecode(href.replace(/^<|>$/g, '').trim());
    if (!isPrivateTarget(target, resolve)) return all;
    return bang === '!' ? '' : PRIVATE_STANDIN;
  });
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
}

const FRONTMATTER = /^\uFEFF?---[ \t]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;

/** A vault file's path as an address may use it: relative, inside the vault, never climbing out or naming a drive. */
export const okVaultRel = (rel: string): boolean => {
  const t = String(rel ?? '').replace(/\\/g, '/').trim();
  return !!t && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(t) && !t.startsWith('/') && !t.split('/').some((s) => s === '..' || s === '.');
};

const stripHidden = (s: string): string =>
  s
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!--[\s\S]*$/, '')
    .replace(/%%[\s\S]*?%%/g, '');

/**
 * Hidden words out of a shared copy: HTML comments (never words for a person, as plain-text.ts holds) and %%hidden%%
 * over any number of lines (as the reading view hides them), outside fenced code, where they are samples to keep.
 * A stray marker with no pair reads as written.
 */
export function withoutHidden(md: string): string {
  const lines = String(md ?? '').split('\n');
  const out: string[] = [];
  let fence = false;
  let buf: string[] = [];
  const flush = () => {
    if (buf.length) out.push(stripHidden(buf.join('\n')));
    buf = [];
  };
  for (const l of lines) {
    if (/^(\s*)(```|~~~)/.test(l)) {
      flush();
      fence = !fence;
      out.push(l);
      continue;
    }
    if (fence) out.push(l);
    else buf.push(l);
  }
  flush();
  return out.join('\n');
}

/** The page as it reads: no properties, no hidden words, no secrets, no private notes. What the PDF and the
 *  formatted copy are made of. A meeting's named voices read in their names here (6 Nov 2026: the PDF still said
 *  "Speaker 1/2" after they were named), taken from the note's own properties before they are left out; the mic
 *  reads as the owner when `me` names them. */
export function shareBody(text: string, o: ShareResolve = {}): string {
  const body = withoutPrivate(withoutSecrets(withoutHidden(withSpeakerNames(String(text ?? ''), o.me).replace(FRONTMATTER, ''))), o).replace(/^\s*\n/, '');
  return body.trim() ? `${body.trim()}\n` : '';
}

/** Save as Markdown: the file as is (properties kept), with secrets and private notes taken out. */
export function shareMarkdownFile(text: string, o: ShareResolve = {}): string {
  return withoutPrivate(withoutSecrets(String(text ?? '')), o);
}

/** The page's own first heading (for the copy's title: a body that starts with it doesn't say it twice). */
export function firstHeading(body: string): string {
  return /^\s{0,3}#{1,6}\s+(.+?)\s*$/.exec(String(body ?? '').replace(FRONTMATTER, '').trim().split('\n')[0] ?? '')?.[1]?.trim() ?? '';
}

// ── Attachments: the files the note carries ─────────────────────────────────────────────────────────────────────────

const HAS_EXT = /\.([a-z0-9]{1,8})$/i;

/** Every file the note carries (pictures, documents): vault paths, each once. Notes, secrets and web links are none. */
export function attachmentsOf(text: string, o: ShareResolve = {}): string[] {
  const resolve = o.resolve ?? ((t: string) => t);
  const out: string[] = [];
  const seen = new Set<string>();
  const keep = (target: string) => {
    const t = safeDecode(target).trim().replace(/^<|>$/g, '');
    if (!t || /^(https?:|mailto:|data:|#|secret:)/i.test(t)) return;
    const rel = resolve(t);
    if (isPrivatePath(rel) || /\.md$/i.test(rel) || !HAS_EXT.test(rel)) return;
    if (!seen.has(rel)) {
      seen.add(rel);
      out.push(rel);
    }
  };
  for (const m of String(text ?? '').matchAll(/!\[\[([^\[\]\n]+?)\]\]|\[\[([^\[\]\n]+?)\]\]/g)) keep(wikiTarget(m[1] ?? m[2]).target);
  for (const m of String(text ?? '').matchAll(/!?\[[^\]\n]*\]\(\s*(<[^>\n]+>|[^)\s]+)(?:\s+"[^"]*")?\s*\)/g)) keep(m[1]);
  return out;
}

// ── Copy as formatted text: headings, lists and tables kept ─────────────────────────────────────────────────────────

const esc = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const IMG_EXT = /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)$/i;
const EXTERNAL = /^(https?:|mailto:)/i;

/** One line's own marks: pictures, links as words (web links kept), bold, italics, code. Safe to paste anywhere. */
function inline(s: string, o: ShareHtmlOpts): string {
  const codes: string[] = [];
  let t = esc(s).replace(/%%[^%\n]*%%/g, '');
  t = t.replace(/`([^`\n]+)`/g, (_, c: string) => `\u0000${codes.push(`<code>${c}</code>`) - 1}\u0000`);
  const img = (alt: string, target: string) => {
    const clean = safeDecode(target).replace(/^<|>$/g, '').trim();
    if (!clean || /^secret:/i.test(clean)) return '';
    if (/^data:image\//i.test(clean)) return `<img src="${esc(clean)}" alt="${esc(alt)}">`;
    // A remote picture fetches (and tells its host it was opened) wherever the copy lands: its words, never the fetch.
    if (EXTERNAL.test(clean) || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(clean)) return esc(alt);
    // A note or a document reads as words, never a broken picture.
    if (!/\.[a-z0-9]{1,8}$/i.test(clean) || !IMG_EXT.test(clean)) return esc(alt || baseName(clean));
    const rel = (o.resolve ?? ((x: string) => x))(clean);
    if (isPrivatePath(rel) || !okVaultRel(rel)) return '';
    const u = o.url(rel);
    return u ? `<img src="${esc(u)}" alt="${esc(alt)}">` : '';
  };
  t = t.replace(/!\[([^\]\n]*)\]\(\s*(<[^>\n]+>|[^)\s]+)(?:\s+"[^"]*")?\s*\)/g, (_, alt: string, href: string) => img(alt, href));
  t = t.replace(/!\[\[([^\[\]\n]+?)\]\]/g, (_, inner: string) => {
    const { target, alias } = wikiTarget(inner);
    return IMG_EXT.test(target) || !/\.[a-z0-9]{1,8}$/i.test(target) ? img(alias || baseName(target), target) : esc(alias || baseName(target));
  });
  t = t.replace(/\[\[([^\[\]\n]+?)\]\]/g, (_, inner: string) => {
    const { target, alias } = wikiTarget(inner);
    if (alias) return esc(alias);
    if (target && !okVaultRel(safeDecode(target))) return '';
    return esc(linkWords(`[[${inner}]]`));
  });
  t = t.replace(/\[([^\]\n]*)\]\(\s*(<[^>\n]+>|[^)\s]+)(?:\s+"[^"]*")?\s*\)/g, (_, label: string, href: string) => {
    const clean = safeDecode(href.replace(/^<|>$/g, '').trim());
    if (EXTERNAL.test(clean)) return `<a href="${esc(clean)}">${label || esc(clean)}</a>`;
    if (label) return label;
    return okVaultRel(clean) ? esc(baseName(clean)) : '';
  });
  t = t.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/__([^_]+)__/g, '<b>$1</b>');
  t = t.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, '$1<i>$2</i>').replace(/(^|[^_\w])_([^_\s][^_]*?)_(?!\w)/g, '$1<i>$2</i>');
  t = t.replace(/~~([^~]+)~~/g, '<s>$1</s>').replace(/==([^=\n]+)==/g, '<mark>$1</mark>');
  return t.replace(/\u0000(\d+)\u0000/g, (_, i: string) => codes[Number(i)]);
}

export interface ShareHtmlOpts extends ShareResolve {
  /** A vault file's address for the copy (a file:// address: Word and mail programs take the pictures from it). */
  url(rel: string): string;
  /** The person's brand kit, heading the copy when they have one. */
  brand?: BrandKit;
}

/** The page as HTML that pastes into email or Word with headings, lists and tables kept. */
export function shareHtml(title: string, text: string, o: ShareHtmlOpts): string {
  const body = shareBody(text, o);
  const lines = body.split('\n');
  const out: string[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push(`<p>${inline(para.join(' '), o)}</p>`);
    para = [];
  };
  const LIST = /^(\s*)(?:([-*\u2022])|(\d+)[.)])\s+(.*)$/;
  const listAt: { ordered: boolean; indent: number }[] = [];
  const closeLists = (to = -1) => {
    while (listAt.length > Math.max(0, to)) out.push(listAt.pop()!.ordered ? '</ol>' : '</ul>');
  };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (!l.trim()) {
      flush();
      closeLists();
      continue;
    }
    const fence = /^(\s*)(```|~~~)/.exec(l);
    if (fence) {
      flush();
      closeLists();
      const code: string[] = [];
      for (i++; i < lines.length && !lines[i]!.startsWith(fence[1] + fence[2]); i++) code.push(lines[i]!);
      out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
      continue;
    }
    if (/^\s{0,3}#{1,6}\s+/.test(l)) {
      flush();
      closeLists();
      const m = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(l)!;
      out.push(`<h${m[1].length}>${inline(m[2], o)}</h${m[1].length}>`);
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(l)) {
      flush();
      closeLists();
      const rows: string[][] = [];
      for (; i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]!); i++)
        rows.push(lines[i]!.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').trim()));
      i--;
      const ruled = rows.length > 1 && rows[1]!.every((c) => /^:?-{2,}:?$/.test(c));
      const head = ruled ? rows[0]! : null;
      const rest = rows.slice(ruled ? 2 : 0).filter((r) => !r.every((c) => /^:?-{2,}:?$/.test(c)));
      out.push(`<table>${head ? `<thead><tr>${head.map((c) => `<th>${inline(c, o)}</th>`).join('')}</tr></thead>` : ''}<tbody>${rest.map((r) => `<tr>${r.map((c) => `<td>${inline(c, o)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    const li = LIST.exec(l);
    if (li) {
      flush();
      const indent = Math.min(6, Math.floor(li[1].replace(/\t/g, '  ').length / 2));
      const ordered = !!li[3];
      while (listAt.length > indent + 1 || (listAt.length === indent + 1 && listAt[listAt.length - 1]!.ordered !== ordered)) closeLists(listAt.length - 2);
      while (listAt.length < indent + 1) {
        out.push(ordered && listAt.length === indent ? '<ol>' : '<ul>');
        listAt.push({ ordered: ordered && listAt.length === indent, indent: listAt.length });
      }
      const task = /^(\[[ xX]\])\s+(.*)$/.exec(li[4]);
      out.push(task ? `<li>${task[1].toLowerCase() === '[x]' ? '☑' : '☐'} ${inline(task[2], o)}</li>` : `<li>${inline(li[4], o)}</li>`);
      continue;
    }
    if (/^>\s?/.test(l)) {
      flush();
      closeLists();
      const quote: string[] = [];
      for (; i < lines.length && /^>\s?/.test(lines[i]!); i++) quote.push(lines[i]!.replace(/^>\s?/, '').replace(/^\[![\w-]+\][+-]?\s*/, ''));
      i--;
      out.push(`<blockquote>${inline(quote.join(' '), o)}</blockquote>`);
      continue;
    }
    if (/^\s{0,3}(---|\*\*\*|___)\s*$/.test(l)) {
      flush();
      closeLists();
      out.push('<hr>');
      continue;
    }
    para.push(l.trim());
  }
  flush();
  closeLists();
  const head = o.brand ? brandHead(o.brand, o.url) : '';
  const name = String(title ?? '').trim();
  const headed = name && firstHeading(body).toLowerCase() !== name.toLowerCase() ? `<h1>${esc(name)}</h1>` : '';
  return `${head}${headed}${out.join('')}`;
}

// ── The person's brand kit, heading the copy when they have one ────────────────────────────────────────────────────

export function brandHead(brand: BrandKit, url: (rel: string) => string): string {
  const name = brand?.name?.trim() ?? '';
  const logoRel = brand?.logos?.primary ?? '';
  const logo = logoRel && !isPrivatePath(logoRel) && okVaultRel(logoRel) ? url(logoRel) : '';
  // The heading colour, else the first colour: the same accent the branded document takes, on every door.
  const colours = brand?.colours ?? [];
  const colour = cleanHex((colours.find((c) => /head/i.test(c.use ?? '')) ?? colours[0])?.hex);
  if (!name && !logo && !colour) return '';
  // Styled inline, so it holds in the PDF and on paste into Word or email (no page styles travel with a copy).
  const bar = colour ? `border-top:3pt solid ${esc(colour)};` : 'border-top:3pt solid #8a3f22;';
  return `<div class="share-brand" style="${bar}padding:10pt 0 14pt;margin:0 0 8pt;"><table cellpadding="0" cellspacing="0" style="border:none;border-collapse:collapse;"><tr>${logo ? `<td style="vertical-align:middle;padding-right:10pt;"><img class="share-logo" src="${esc(logo)}" alt="" style="height:28pt;width:auto;display:block;"></td>` : ''}${name ? `<td style="vertical-align:middle;"><div class="share-name" style="font-family:Georgia,'Times New Roman',serif;font-size:16pt;line-height:1.1;${colour ? `color:${esc(colour)};` : ''}">${esc(name)}</div></td>` : ''}</tr></table></div>`;
}

// ── Email it: a draft in the person's mail program, never sent by itself ─────────────────────────────────────────────

const b64tab = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function utf8Base64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += b64tab[(n >> 18) & 63] + b64tab[(n >> 12) & 63] + (i + 1 < bytes.length ? b64tab[(n >> 6) & 63] : '=') + (i + 2 < bytes.length ? b64tab[n & 63] : '=');
  }
  return out;
}

/** A header's words, encoded when they aren't plain ASCII. */
function mimeWord(s: string): string {
  const t = String(s ?? '');
  return /^[\x20-\x7e]*$/.test(t) ? t : `=?UTF-8?B?${utf8Base64(t)}?=`;
}

export interface EmlDraft {
  subject: string;
  body: string;
  pdfName: string;
  /** The PDF's bytes, base64. */
  pdfBase64: string;
  date?: string;
}

/**
 * The mail program's draft with the PDF attached (a .eml file it opens): the subject, the words, the PDF. Opening
 * the draft is all the app does; sending stays the person's.
 */
export function emlDraft(d: EmlDraft): string {
  const boundary = `----NVShare${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
  const date = d.date ?? new Date().toUTCString();
  const pdf = String(d.pdfBase64 ?? '').replace(/\s+/g, '');
  const wrapped = pdf.replace(/.{1,76}/g, '$&\r\n');
  return (
    `Date: ${date}\r\nSubject: ${mimeWord(d.subject) || '(no subject)'}\r\nX-Unsent: 1\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n` +
    `--${boundary}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${String(d.body ?? '')}\r\n\r\n` +
    `--${boundary}\r\nContent-Type: application/pdf; name="${mimeWord(d.pdfName)}"\r\nContent-Transfer-Encoding: base64\r\nContent-Disposition: attachment; filename="${mimeWord(d.pdfName)}"\r\n\r\n${wrapped}--${boundary}--\r\n`
  );
}

/** When the draft file won't open: the mail program with the subject and words, the PDF named to attach. */
export function mailtoFallback(o: { subject: string; body: string }): string {
  return `mailto:?subject=${encodeURIComponent(o.subject)}&body=${encodeURIComponent(o.body)}`;
}
