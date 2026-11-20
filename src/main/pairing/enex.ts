// Evernote's notebook export, .enex (V9, 28 Oct 2026): XML with one <note> per note — its title, created and updated
// times, tags, attributes (source URL, author, reminder) and its words as ENML (Evernote's HTML) — and its pictures and
// files as base64 <resource>s, each named in the words by the MD5 of its bytes (<en-media hash="…">). One file per
// notebook; a folder or zip of them is several notebooks. Evernote writes no id of its own into an export, so a note is
// known again by its created time and title.

import { createHash } from 'node:crypto';
import { decodeEntities, htmlToMarkdown } from '../../shared/vault-merge';
import { fileSafe, isoMinute, linkToken, tagSafe, type SourceFile, type SourceItem } from './source';

const tagText = (xml: string, tag: string): string | null => {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i').exec(xml);
  return m ? unwrap(m[1]) : null;
};
const tagAll = (xml: string, tag: string): string[] => [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'gi'))].map((m) => unwrap(m[1]));
/** An element's text: CDATA as it is, else with XML's entities read. */
function unwrap(s: string): string {
  const c = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(s);
  return c ? c[1] : decodeEntities(s.trim());
}

/** "20240102T030405Z" → a Date. */
export function enexTime(s: string | null): Date | null {
  const m = s && /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(s.trim());
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
  return Number.isNaN(d.getTime()) ? null : d;
}

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/heic': 'heic', 'image/heif': 'heif', 'image/tiff': 'tiff', 'image/bmp': 'bmp', 'application/pdf': 'pdf', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-m4a': 'm4a', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/flac': 'flac', 'audio/aac': 'aac', 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/x-msvideo': 'avi', 'video/webm': 'webm', 'application/msword': 'doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx', 'application/vnd.ms-excel': 'xls', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx', 'application/vnd.ms-powerpoint': 'ppt', 'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx', 'application/vnd.oasis.opendocument.text': 'odt', 'application/vnd.oasis.opendocument.spreadsheet': 'ods', 'application/vnd.oasis.opendocument.presentation': 'odp', 'application/zip': 'zip', 'text/plain': 'txt', 'text/csv': 'csv', 'text/markdown': 'md', 'application/json': 'json' };

/** One notebook's notes (`notebook`: its name, the folder they go in when there are several). */
export function readEnex(xml: string, notebook: string): { items: SourceItem[]; skipped: { what: string; why: string }[] } {
  const items: SourceItem[] = [];
  const skipped: { what: string; why: string }[] = [];
  const seen = new Map<string, number>();
  for (const m of xml.matchAll(/<note>([\s\S]*?)<\/note>/gi)) {
    const note = m[1];
    const title = (tagText(note, 'title') ?? '').trim() || 'Untitled note';
    const created = enexTime(tagText(note, 'created'));
    const updated = enexTime(tagText(note, 'updated'));
    // Pictures and files, by the MD5 of their bytes.
    const files: SourceFile[] = [];
    const byHash = new Map<string, SourceFile & { mime: string }>();
    for (const r of note.matchAll(/<resource>([\s\S]*?)<\/resource>/gi)) {
      const res = r[1];
      const data64 = /<data[^>]*>([\s\S]*?)<\/data>/i.exec(res)?.[1] ?? '';
      const data = Buffer.from(data64.replace(/\s+/g, ''), 'base64');
      if (!data.length) continue;
      const mime = (tagText(res, 'mime') ?? '').toLowerCase();
      const hash = createHash('md5').update(data).digest('hex');
      const given = tagText(res, 'file-name');
      const ext = EXT[mime] ?? (/^[^/]+\/([a-z0-9]{1,5})$/.exec(mime)?.[1]);
      const name = fileSafe(given || `${title} ${byHash.size + 1}.${ext ?? 'bin'}`, `File ${byHash.size + 1}`);
      // An attachment of a kind with no known ending (F14): kept with its bytes, and said, never a mystery .bin.
      if (!given && !ext) skipped.push({ what: `${title}’s attachment`, why: mime ? `Evernote called it ${mime}, kept as ${name}.bin` : 'Evernote gave it no kind, kept as .bin' });
      const f = { key: `${notebook}/${hash}`, name: /\.[a-z0-9]{1,5}$/i.test(name) ? name : `${name}.${ext ?? 'bin'}`, data, mime };
      byHash.set(hash, f);
      files.push(f);
    }
    const content = tagText(note, 'content') ?? '';
    const used = new Set<string>();
    const media: string[] = [];
    // Pictures the words show but the export doesn't hold (F13): counted, marked in the note, and said in skipped.
    let missingMedia = 0;
    let enml = content
      .replace(/<\?xml[^>]*\?>/gi, '')
      .replace(/<!DOCTYPE[^>]*>/gi, '')
      // Ticks: Evernote's own element as an input the HTML reader knows.
      .replace(/<en-todo\b([^>]*)\/?>(?:<\/en-todo>)?/gi, (_, a: string) => (/checked\s*=\s*["']?true/i.test(a) ? '<input type="checkbox" checked>' : '<input type="checkbox">'))
      // Encrypted text stays in Evernote (its password is the person's).
      .replace(/<en-crypt\b[^>]*>[\s\S]*?<\/en-crypt>/gi, ' (encrypted text, not brought in) ')
      // Pictures and files: a mark the Markdown keeps, made into a link once converted.
      .replace(/<en-media\b([^>]*)\/?>(?:<\/en-media>)?/gi, (_, a: string) => {
        const hash = /hash\s*=\s*["']([0-9a-f]{32})["']/i.exec(a)?.[1]?.toLowerCase();
        const f = hash ? byHash.get(hash) : undefined;
        if (!f) {
          missingMedia++;
          return ' (a picture not in the export) ';
        }
        used.add(f.key);
        media.push(f.mime.startsWith('image/') || f.mime === 'application/pdf' ? linkToken('embed-file', f.key) : linkToken('file', f.key, f.name));
        return `<span>\u0003M${media.length - 1}\u0003</span>`;
      });
    enml = enml.replace(/<en-note\b[^>]*>/i, '<div>').replace(/<\/en-note>/i, '</div>');
    const converted = htmlToMarkdown(enml);
    let md = converted.markdown;
    for (const s of converted.skipped) skipped.push({ what: `${title}: ${s.what}`, why: s.why });
    md = md.replace(/\u0003M(\d+)\u0003/g, (_, i: string) => media[Number(i)] ?? '');
    // A tick on a line of its own is a task.
    md = md.replace(/^(\s*)\[( |x)\] /gm, '$1- [$2] ');
    // Files the words never showed are listed at the end, so none is lost.
    const loose = files.filter((f) => !used.has(f.key));
    if (loose.length) md = `${md.trimEnd()}\n\n## Attachments\n\n${loose.map((f) => `- ${linkToken('file', f.key, f.name)}`).join('\n')}\n`;
    const props: Record<string, string | string[]> = {};
    const tags = tagAll(note, 'tag').map(tagSafe).filter(Boolean);
    if (tags.length) props.tags = [...new Set(tags)];
    if (created) props.created = isoMinute(created);
    if (updated) props.updated = isoMinute(updated);
    const attrs = tagText(note, 'note-attributes') ?? '';
    const url = tagText(attrs, 'source-url');
    if (url) props.url = url;
    const author = tagText(attrs, 'author');
    if (author) props.author = author;
    const reminder = enexTime(tagText(attrs, 'reminder-time'));
    if (reminder) props.reminder = isoMinute(reminder);
    const key = `${created ? created.toISOString() : ''}|${title}`;
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    if (missingMedia) skipped.push({ what: title, why: missingMedia === 1 ? 'a picture it showed wasn’t in the export' : `${missingMedia} pictures it showed weren’t in the export` });
    items.push({ id: `${notebook}/${key}${count > 1 ? `|${count}` : ''}`, title, folder: '', props, body: md, files });
  }
  if (!items.length && !/<en-export\b/i.test(xml)) skipped.push({ what: notebook, why: 'it isn’t an Evernote export' });
  return { items, skipped };
}
