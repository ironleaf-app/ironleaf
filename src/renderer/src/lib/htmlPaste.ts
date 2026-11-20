// Rich paste (fnv3 F22): words copied from a web page arrive as HTML; their structure (headings, lists, links,
// bold) becomes the Markdown a note is written in, instead of being flattened to plain text. Scripts, styles and
// anything else active are dropped whole: the conversion fails closed, never passing raw HTML into a note.

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ' };
const decode = (s: string): string => s.replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp);/g, (m) => ENTITIES[m] ?? m).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));

/** HTML as copied from a page, as Markdown. Plain text in, (tidied) plain text out. */
export function htmlToMarkdown(html: string): string {
  let s = String(html ?? '');
  // Every tag name ends at a space, a slash or its bracket (t136, 9 Nov 2026: `<b` matched the pasted page's own
  // `<body>` and swallowed everything to the first `</b>`, so a paste arrived as `**## Market list Buy flour**`).
  s = s.replace(/<(script|style|noscript|iframe|object|form)(?=[\s/>])[\s\S]*?<\/\1\s*>/gi, '');
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<h([1-6])(?=[\s/>])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, n, body) => `\n\n${'#'.repeat(Number(n))} ${plain(body)}\n\n`);
  s = s.replace(/<a(?=[\s/>])[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, body) => { const t = plain(body); const u = decode(String(href).trim()); return t && u ? `[${t}](${u})` : t; });
  s = s.replace(/<(?:b|strong)(?=[\s/>])[^>]*>([\s\S]*?)<\/(?:b|strong)>/gi, (_, body) => `**${plain(body)}**`);
  s = s.replace(/<(?:i|em)(?=[\s/>])[^>]*>([\s\S]*?)<\/(?:i|em)>/gi, (_, body) => `*${plain(body)}*`);
  s = s.replace(/<code(?=[\s/>])[^>]*>([\s\S]*?)<\/code>/gi, (_, body) => `\`${plain(body)}\``);
  // A numbered list keeps its numbers (t136, 9 Nov 2026: it arrived as bullets); other lists bullet below.
  s = s.replace(/<ol(?=[\s/>])[^>]*>([\s\S]*?)<\/ol\s*>/gi, (_, body) => {
    let n = 0;
    return `${String(body).replace(/<li(?=[\s/>])[^>]*>([\s\S]*?)<\/li\s*>/gi, (_, item) => `\n${++n}. ${inline(item)}`)}\n`;
  });
  s = s.replace(/<li(?=[\s/>])[^>]*>([\s\S]*?)<\/li>/gi, (_, body) => `\n- ${inline(body)}`);
  s = s.replace(/<\/(?:ul|ol)>/gi, '\n');
  // A table keeps its shape as a table: the first row, then the rule Markdown needs, then the rest (t136, 9 Nov
  // 2026: rows arrived with no rule, so they never drew as a table). Stray rows outside any table stay as rows.
  s = s.replace(/<table(?=[\s/>])[^>]*>([\s\S]*?)<\/table\s*>/gi, (_, body) => {
    const rows = [...String(body).matchAll(/<tr(?=[\s/>])[^>]*>([\s\S]*?)<\/tr\s*>/gi)].map((r) => [...r[1].matchAll(/<t[dh](?=[\s/>])[^>]*>([\s\S]*?)<\/t[dh]\s*>/gi)].map((c) => inline(c[1])));
    if (!rows.length) return '';
    const width = Math.max(...rows.map((r) => r.length));
    const line = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => r[i] ?? '').join(' | ')} |`;
    return `\n\n${[line(rows[0]), `| ${Array.from({ length: width }, () => '---').join(' | ')} |`, ...rows.slice(1).map(line)].join('\n')}\n\n`;
  });
  s = s.replace(/<tr(?=[\s/>])[^>]*>([\s\S]*?)<\/tr>/gi, (_, body) => `\n| ${[...String(body).matchAll(/<t[dh](?=[\s/>])[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => inline(c[1])).join(' | ')} |`);
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(?:p|div|section|article|blockquote|pre)>/gi, '\n\n');
  s = s.replace(/<[^>]+>/g, '');
  return decode(s).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

const plain = (html: string): string => decode(String(html).replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
const inline = (html: string): string => htmlToMarkdown(String(html)).replace(/\n+/g, ' ').trim();
