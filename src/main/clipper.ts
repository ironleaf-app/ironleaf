// The web clipper's local side (8.8, 31 Oct 2026): the endpoint on 127.0.0.1 the person's own browser extension talks
// to, and what a clip becomes in the notes. Created inside createIronleaf (src/main/app.ts), so it runs the same on its
// own and inside the former host app (src/main/embed.ts there loads the same module).
//
//   - paired once with the code Settings › Quick add › Web clipper shows (kept in clipper.json in Ironleaf's own
//     data with the browsers' tokens, never in the notes); each request after pairing carries its token;
//   - a web page is refused by its Origin (only the extension's own, or none, is answered) and by its missing token;
//   - a clip becomes a normal Vault note (src/shared/clipper.ts shapes it) with its source link in front matter and its
//     pictures beside it; nothing is ever fetched from the page here (the extension sends what it fetched).
//
// Tested with a made-up vault (tests/clipper-server.test.mjs); the extension's own words live in extensions/clipper/.

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import http from 'node:http';
import {
  CLIPPER_DEFAULT_FOLDER,
  CLIPPER_IMAGES_MAX,
  CLIPPER_PORTS,
  CLIPPER_TOKEN_HEADER,
  cleanClip,
  cleanCode,
  clipBody,
  clipDay,
  clipFrontMatter,
  clipHasNewLines,
  clipImageStem,
  clipNoteText,
  clipPublished,
  clipStamp,
  canonicalClipUrl,
  clipTitle,
  CODE_ALPHABET,
  CODE_LENGTH,
  codeValid,
  extractArticle,
  extractSelection,
  localiseImages,
  type ClipImage,
  type ClipRequest,
} from '../shared/clipper';
import { projectNotesFolder, screenshotName } from '../shared/capture';
import { changeProps, readProps } from '../shared/frontmatter';
import { mergeNote } from '../shared/vault-merge';

/** A folder shipped inside the packaged app, as the rest of the PC sees it (20 Nov 2026): with asar on, Electron reads
 *  `…/resources/app.asar/extensions/clipper` as a folder, but a browser's "Load unpacked", Explorer and every other
 *  program cannot; electron-builder puts the real files beside it in `app.asar.unpacked` (build-standalone/
 *  electron-builder.json asarUnpack "extensions/**"). Paths outside an asar come back as they were. */
export function outsideAsar(p: string): string {
  return p.replace(/([\\/])app\.asar(?=[\\/]|$)/, '$1app.asar.unpacked');
}

/** What a clip needs from Ironleaf (src/main/app.ts gives it). */
export interface ClipperHost {
  dataDir: string;
  version: string;
  /** The web clipper switched on in Settings. */
  clipperOn(): boolean;
  /** The extension's folder on this PC (Settings › Get the extension). */
  extensionDir(): string;
  /** The notes opened when they aren't yet. */
  ready(): Promise<void>;
  /** Changing notes needs the licence once it is enforced. */
  requireCreate(): Promise<void>;
  /** The open vault's name, for the extension's own words. */
  vaultName(): string | null;
  /** Every folder and project a clip can land in. */
  places(): Promise<{ folders: string[]; projects: { path: string; name: string }[] }>;
  /** A free name for a new note in a folder of the library. */
  freeNote(folder: string, title: string): Promise<string>;
  /** A clip already filed from this address (canonical), if there is one. */
  findClip?(source: string): Promise<{ path: string; title: string } | null>;
  /** A kept note's words, for merging a page saved again (10.0 item 16). Absent on old hosts: the first save is kept. */
  readNote?(rel: string): Promise<string | null>;
  /** A saved file's bytes, to reuse a picture already beside the kept note instead of doubling it. */
  readFile?(rel: string): Promise<Buffer | null>;
  writeNote(rel: string, text: string): Promise<void>;
  /** A picture's bytes into a library folder under a free name. */
  saveImage(folder: string, name: string, bytes: Buffer): Promise<string>;
  /** A saved picture as the note embeds it from the note at `from`: the path it was saved under, in the person's
   *  link form (short names collide across notes: every "Picture.png" would resolve to one file). */
  link(rel: string, from: string): string;
  /** Where pasted and dropped files go for a note (Settings › Files and links). */
  attachmentsFor(note: string): string;
  log(message: string): void;
}

/** Eight letters and digits from the code's alphabet, nothing easily mixed up. */
export function makePairingCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

function makeToken(): string {
  return randomBytes(24).toString('base64url');
}

/** A picture's bytes as an extension (checked, never as claimed); null when they are not a kept picture. */
export function sniffImage(bytes: Buffer): 'png' | 'jpg' | 'gif' | 'webp' | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (bytes.length >= 6 && bytes.toString('ascii', 0, 6) === 'GIF87a' || bytes.length >= 6 && bytes.toString('ascii', 0, 6) === 'GIF89a') return 'gif';
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

interface ClipperStore {
  code: string;
  tokens: string[];
  port: number;
}

const BODY_CLIP_MAX = 30 * 1024 * 1024;
const BODY_SMALL_MAX = 16 * 1024;
const PAIR_TOKENS_MAX = 10;

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length > 0 && x.length === y.length && timingSafeEqual(x, y);
}

/** The clipper's own file in Ironleaf's data: its pairing code, its browsers' tokens, its port. */
async function loadStore(file: string): Promise<ClipperStore | null> {
  try {
    const kept = JSON.parse(await fsp.readFile(file, 'utf8')) as Partial<ClipperStore>;
    if (!kept || typeof kept !== 'object' || !codeValid(String(kept.code ?? ''))) return null;
    return { code: String(kept.code), tokens: Array.isArray(kept.tokens) ? kept.tokens.filter((t): t is string => typeof t === 'string' && t.length >= 20).slice(0, PAIR_TOKENS_MAX) : [], port: typeof kept.port === 'number' ? kept.port : 0 };
  } catch {
    return null;
  }
}

async function saveStore(file: string, store: ClipperStore): Promise<void> {
  const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(store), { mode: 0o600 });
  await fsp.rename(tmp, file);
}

/** A folder in the notes, written safely (no way out of the library). */
function cleanFolder(raw: string): string {
  const parts = String(raw ?? '')
    .replace(/\\/g, '/')
    .split('/')
    .map((p) => p.trim().replace(/[<>:"|?*\u0000-\u001f]/g, '').replace(/\.+$/g, '').trim())
    .filter((p) => p && p !== '.' && p !== '..');
  return parts.join('/').slice(0, 300);
}

export interface ClippedNote {
  path: string;
  title: string;
  words: string;
}

/**
 * A page saved again: its new lines merged into the kept note (the person's part untouched,
 * pictures reused by their bytes, never doubled). Nothing new leaves the kept note alone.
 */
async function mergeClip(
  host: ClipperHost,
  clip: ClipRequest,
  prior: { path: string; title: string },
  kept: string,
  now: Date,
  imageBytes: (img: ClipImage) => Buffer | null,
): Promise<ClippedNote> {
  const attachFolder = host.attachmentsFor(prior.path) || CLIPPER_DEFAULT_FOLDER;
  // Fresh words first, no pictures saved yet.
  let freshText = '';
  let freshSite = '';
  let freshAuthor = '';
  let freshPublished = '';
  let imageUrls: string[] = [];
  let sent = new Map<string, ClipImage>();
  if (clip.kind === 'article') {
    const article = extractArticle(clip.html ?? '', clip.url);
    freshText = article.markdown;
    freshSite = clip.site || article.site;
    freshAuthor = clip.author || article.author;
    freshPublished = clipPublished(clip.published || article.published);
    imageUrls = article.images;
    sent = new Map((clip.images ?? []).map((img) => [img.url, img]));
  } else if (clip.kind === 'selection') {
    const sel = extractSelection(clip.html ?? '', clip.text ?? '', clip.url);
    freshText = sel.markdown;
    freshSite = clip.site || '';
    freshAuthor = clip.author || '';
    freshPublished = clipPublished(clip.published || '');
    imageUrls = sel.images;
    sent = new Map((clip.images ?? []).map((img) => [img.url, img]));
  } else {
    freshText = clip.description || '';
    freshSite = clip.site || '';
    freshPublished = clipPublished(clip.published || '');
  }
  const keptProps = readProps(kept);
  const keptTags = Array.isArray(keptProps.tags) ? keptProps.tags.filter((t): t is string => typeof t === 'string') : typeof keptProps.tags === 'string' ? [keptProps.tags] : [];
  const freshTags = clip.tags ?? [];
  const freshNote = (clip.note ?? '').trim();
  const newLines = clipHasNewLines(kept, freshText);
  const newNote = !!freshNote && !kept.includes(freshNote);
  const newTags = freshTags.some((t) => !keptTags.includes(t));
  const newMeta = (!!freshSite && freshSite !== keptProps.site) || (!!freshAuthor && clip.kind !== 'bookmark' && freshAuthor !== keptProps.author) || (!!freshPublished && freshPublished !== keptProps.published);
  // A picture already beside the kept note, by its bytes: reused, never a numbered copy beside it.
  const saved = new Map<string, string>();
  const reuseOrKeep = async (img: ClipImage, fallback: string): Promise<string | null> => {
    const bytes = imageBytes(img);
    if (!bytes) return null;
    const ext = sniffImage(bytes);
    const stem = clipImageStem(img.url, fallback);
    const candidate = `${attachFolder}/${stem}.${ext}`;
    if (host.readFile) {
      const there = await host.readFile(candidate).catch(() => null);
      if (there && there.equals(bytes)) {
        const embed = `!${host.link(candidate, prior.path)}`;
        if (img.url) saved.set(img.url, embed);
        return embed;
      }
    }
    const rel = await host.saveImage(attachFolder, `${stem}.${ext}`, bytes);
    const embed = `!${host.link(rel, prior.path)}`;
    if (img.url) saved.set(img.url, embed);
    return embed;
  };
  // Same words but new pictures (a page that only changed its pictures): checked by bytes, saved below.
  let newPictures = false;
  if (!newLines && host.readFile) {
    const urls = clip.kind === 'bookmark' ? (clip.images ?? []).map((img) => img.url) : imageUrls;
    for (const url of urls.slice(0, CLIPPER_IMAGES_MAX)) {
      const img = clip.kind === 'bookmark' ? (clip.images ?? []).find((i) => i.url === url) : sent.get(url);
      if (!img) continue;
      const bytes = imageBytes(img);
      if (!bytes) continue;
      const candidate = `${attachFolder}/${clipImageStem(img.url, 'Picture')}.${sniffImage(bytes)}`;
      const there = await host.readFile(candidate).catch(() => null);
      if (!there || !there.equals(bytes)) {
        newPictures = true;
        break;
      }
    }
  }
  if (!newLines && !newNote && !newTags && !newMeta && !newPictures) {
    return { path: prior.path, title: prior.title, words: `“${prior.title}” is already clipped: nothing new on the page.` };
  }
  let merged = kept;
  if (newLines || newPictures) {
    if (clip.kind === 'bookmark') {
      const embeds: string[] = [];
      for (const img of (clip.images ?? []).slice(0, CLIPPER_IMAGES_MAX)) {
        const embed = await reuseOrKeep(img, 'Picture');
        if (embed) embeds.push(embed);
      }
      const fresh = [clip.description || '', embeds.join('\n')].filter(Boolean).join('\n\n') + '\n';
      merged = mergeNote(kept, fresh, 'the page', clipDay(now)).text;
    } else {
      for (const url of imageUrls.slice(0, CLIPPER_IMAGES_MAX)) {
        const img = sent.get(url);
        if (img) await reuseOrKeep(img, 'Picture');
      }
      merged = mergeNote(kept, localiseImages(freshText, saved), 'the page', clipDay(now)).text;
    }
  }
  // The note's properties kept fresh: new tags added, the page's new facts taken, first clipped kept.
  const union = [...new Set([...keptTags, ...freshTags])];
  merged = changeProps(merged, (doc) => {
    if (freshSite) doc.set('site', freshSite);
    if (freshAuthor && clip.kind !== 'bookmark') doc.set('author', freshAuthor);
    if (freshPublished) doc.set('published', freshPublished);
    if (union.length) doc.set('tags', doc.createNode(union));
    doc.set('updated', clipStamp(now));
  });
  // The person's new note on the re-save, first, when it is not there already.
  if (newNote) {
    const m = /^(---\n[\s\S]*?\n---\n\n?)/.exec(merged);
    merged = m ? `${m[1]}${freshNote}\n\n${merged.slice(m[1].length)}` : `${freshNote}\n\n${merged}`;
  }
  await host.writeNote(prior.path, merged);
  return { path: prior.path, title: prior.title, words: `“${prior.title}” is already clipped: updated with what changed on the page.` };
}

/** A clip filed in the notes: its pictures beside it, its note with its source link in front matter. */
export async function fileClip(host: ClipperHost, raw: unknown, now = new Date()): Promise<ClippedNote> {
  let clip: ClipRequest;
  try {
    clip = cleanClip(raw);
  } catch (err) {
    throw Object.assign(err instanceof Error ? err : new Error('The clip could not be read. Try again.'), { status: 400 });
  }
  await host.requireCreate();
  await host.ready();
  const { projects } = await host.places();
  let folder = CLIPPER_DEFAULT_FOLDER;
  let projectName: string | null = null;
  if (clip.place?.kind === 'folder') folder = cleanFolder(clip.place.path) || CLIPPER_DEFAULT_FOLDER;
  else if (clip.place?.kind === 'project') {
    const found = projects.find((p) => p.path === clip.place!.path);
    if (!found) throw new Error('That project isn’t there any more. Pick another, or a folder.');
    projectName = found.name;
    folder = projectNotesFolder(found.path);
  }
  const imageBytes = (img: ClipImage): Buffer | null => {
    try {
      const bytes = Buffer.from(img.data, 'base64');
      return bytes.length > 0 && sniffImage(bytes) ? bytes : null;
    } catch {
      return null;
    }
  };
  // The note's name first (its pictures' folder and links follow from it).
  const title = clip.kind === 'screenshot' ? clipTitle(clip.title || clip.site || '', clip.url, now) : clipTitle(clip.title, clip.url, now);
  // One address, one note (a screenshot is a moment, always kept): saving again merges into the kept note (10.0 item 16).
  if (clip.kind !== 'screenshot' && clip.url && host.findClip) {
    const prior = await host.findClip(canonicalClipUrl(clip.url));
    if (prior) {
      // An old host without a reader keeps the first save, as before.
      if (!host.readNote) return { path: prior.path, title: prior.title, words: `“${prior.title}” is already clipped: kept the first save.` };
      const kept = await host.readNote(prior.path).catch(() => null);
      // Gone since: fall through and make it again.
      if (kept !== null) return mergeClip(host, clip, prior, kept, now, imageBytes);
    }
  }
  const noteRel = await host.freeNote(folder, title);
  const attachFolder = host.attachmentsFor(noteRel) || folder;
  const saved = new Map<string, string>();
  const keep = async (img: ClipImage, fallback: string): Promise<string | null> => {
    const bytes = imageBytes(img);
    if (!bytes) return null;
    // Its own name (the saver finds a free one when it is taken); the note embeds it by path.
    const rel = await host.saveImage(attachFolder, `${clipImageStem(img.url, fallback)}.${sniffImage(bytes)}`, bytes);
    const embed = `!${host.link(rel, noteRel)}`;
    if (img.url) saved.set(img.url, embed);
    return embed;
  };
  if (clip.kind === 'article') {
    const article = extractArticle(clip.html ?? '', clip.url);
    const sent = new Map((clip.images ?? []).map((img) => [img.url, img]));
    for (const url of article.images.slice(0, CLIPPER_IMAGES_MAX)) {
      const img = sent.get(url);
      if (img) await keep(img, 'Picture');
    }
    const front = clipFrontMatter({ source: clip.url, site: clip.site || article.site, author: clip.author || article.author, published: clipPublished(clip.published || article.published), clipped: clipStamp(now), tags: clip.tags ?? [] });
    const body = clipBody({ kind: clip.kind, note: clip.note ?? '', markdown: localiseImages(article.markdown, saved), description: '', embeds: [], url: clip.url, title: article.title || title, site: clip.site || article.site, day: clipDay(now) });
    await host.writeNote(noteRel, clipNoteText(front, body));
  } else if (clip.kind === 'selection') {
    const sel = extractSelection(clip.html ?? '', clip.text ?? '', clip.url);
    const sent = new Map((clip.images ?? []).map((img) => [img.url, img]));
    for (const url of sel.images.slice(0, CLIPPER_IMAGES_MAX)) {
      const img = sent.get(url);
      if (img) await keep(img, 'Picture');
    }
    const front = clipFrontMatter({ source: clip.url, site: clip.site || '', author: clip.author || '', published: clipPublished(clip.published || ''), clipped: clipStamp(now), tags: clip.tags ?? [] });
    const body = clipBody({ kind: clip.kind, note: clip.note ?? '', markdown: localiseImages(sel.markdown, saved), description: '', embeds: [], url: clip.url, title, site: clip.site || '', day: clipDay(now) });
    await host.writeNote(noteRel, clipNoteText(front, body));
  } else if (clip.kind === 'bookmark') {
    const embeds: string[] = [];
    for (const img of (clip.images ?? []).slice(0, CLIPPER_IMAGES_MAX)) {
      const embed = await keep(img, 'Picture');
      if (embed) embeds.push(embed);
    }
    const front = clipFrontMatter({ source: clip.url, site: clip.site || '', author: '', published: clipPublished(clip.published || ''), clipped: clipStamp(now), tags: clip.tags ?? [] });
    const body = clipBody({ kind: clip.kind, note: clip.note ?? '', markdown: '', description: clip.description || '', embeds, url: clip.url, title, site: clip.site || '', day: clipDay(now) });
    await host.writeNote(noteRel, clipNoteText(front, body));
  } else {
    const bytes = imageBytes(clip.screenshot!);
    if (!bytes) throw new Error('The screenshot did not come through. Try again.');
    const rel = await host.saveImage(attachFolder, `${screenshotName(now).replace(/\.png$/i, '')}.${sniffImage(bytes)}`, bytes);
    const front = clipFrontMatter({ source: clip.url, site: clip.site || '', author: '', published: '', clipped: clipStamp(now), tags: clip.tags ?? [] });
    const body = clipBody({ kind: clip.kind, note: clip.note ?? '', markdown: '', description: '', embeds: [`!${host.link(rel, noteRel)}`], url: clip.url, title, site: clip.site || '', day: clipDay(now) });
    await host.writeNote(noteRel, clipNoteText(front, body));
  }
  const where = projectName ?? (folder === CLIPPER_DEFAULT_FOLDER ? 'your clippings' : folder);
  return { path: noteRel, title, words: `Clipped to ${where}.` };
}

export interface ClipperStatus {
  /** Switched on in Settings. */
  on: boolean;
  /** The pairing code, kept form (the window groups it). */
  code: string;
  /** Browsers paired. */
  paired: number;
  /** The port listened on (0: not listening). */
  port: number;
  /** The extension's folder on this PC. */
  extensionDir: string;
}

/** The endpoint the person's own browser extension talks to: 127.0.0.1 only, paired browsers only. */
export class ClipperService {
  private server: http.Server | null = null;
  private store: ClipperStore | null = null;
  private attempts: number[] = [];
  private readonly file: string;

  constructor(private readonly host: ClipperHost) {
    this.file = `${host.dataDir}/clipper.json`;
  }

  get port(): number {
    return this.store?.port ?? 0;
  }

  /** Listens on the first free clipper port (kept listening while off, so the extension can say so plainly). */
  async start(): Promise<number> {
    if (this.server && this.store) return this.store.port;
    this.store = (await loadStore(this.file)) ?? { code: makePairingCode(), tokens: [], port: 0 };
    if (!codeValid(this.store.code)) this.store.code = makePairingCode();
    const server = http.createServer((req, res) => void this.answer(req, res));
    server.on('clientError', (_err, socket) => socket.destroy());
    let port = 0;
    let lastError: unknown = null;
    for (const p of CLIPPER_PORTS) {
      try {
        await new Promise<void>((resolve, reject) => {
          server.once('error', reject);
          server.listen(p, '127.0.0.1', () => resolve());
        });
        server.removeAllListeners('error');
        port = p;
        break;
      } catch (err) {
        lastError = err;
      }
    }
    if (!port) throw lastError instanceof Error ? lastError : new Error('The web clipper could not listen on this PC.');
    server.unref();
    this.server = server;
    this.store.port = port;
    await saveStore(this.file, this.store).catch((err) => this.host.log(`The web clipper could not keep its pairing: ${err instanceof Error ? err.message : String(err)}`));
    return port;
  }

  async stop(): Promise<void> {
    const s = this.server;
    this.server = null;
    this.store = null;
    if (!s) return;
    // Waiting connections (the extension's fetch keeps its sockets) go too, so the port is free at once.
    s.closeAllConnections();
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }

  status(): ClipperStatus {
    return { on: this.host.clipperOn(), code: this.store?.code ?? '', paired: this.store?.tokens.length ?? 0, port: this.port, extensionDir: this.host.extensionDir() };
  }

  /** Whether a request's token paired (timing-safe, against every kept token). */
  paired(headers: Record<string, string | string[] | undefined>): boolean {
    const given = headers[CLIPPER_TOKEN_HEADER];
    const token = Array.isArray(given) ? given[0] : given;
    if (typeof token !== 'string' || !this.store) return false;
    return this.store.tokens.some((t) => sameSecret(token, t));
  }

  private async pair(code: string): Promise<string | null> {
    if (!this.store) return null;
    const now = Date.now();
    this.attempts = this.attempts.filter((at) => now - at < 60_000);
    if (this.attempts.length >= 10) return null;
    this.attempts.push(now);
    if (!sameSecret(cleanCode(code), this.store.code)) return null;
    const token = makeToken();
    this.store.tokens = [...this.store.tokens.filter((t) => t !== token), token].slice(-PAIR_TOKENS_MAX);
    await saveStore(this.file, this.store).catch(() => undefined);
    return token;
  }

  private cors(res: http.ServerResponse, origin: string | undefined): void {
    if (origin && origin.startsWith('chrome-extension://')) {
      res.setHeader('access-control-allow-origin', origin);
      res.setHeader('vary', 'Origin');
    }
  }

  private async answer(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const origin = req.headers.origin;
    const send = (status: number, body: unknown) => {
      this.cors(res, origin);
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    const port = this.port;
    const host = String(req.headers.host ?? '');
    // Only this PC itself (a page elsewhere, or a forwarded Host, is refused).
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return send(403, { error: 'Refused.' });
    // Only the person's own extension (a web page's Origin, or none from the extension's own fetch, is answered).
    if (origin !== undefined && !origin.startsWith('chrome-extension://')) return send(403, { error: 'Refused.' });
    if (req.method === 'OPTIONS') {
      this.cors(res, origin);
      res.writeHead(204, { 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': `content-type, ${CLIPPER_TOKEN_HEADER}`, 'access-control-max-age': '86400' });
      res.end();
      return;
    }
    const url = (req.url ?? '').split('?')[0];
    try {
      if (req.method === 'GET' && url === '/status') {
        const on = this.host.clipperOn();
        const paired = on && this.paired(req.headers as Record<string, string | string[] | undefined>);
        return send(200, { running: true, enabled: on, paired, ...(paired ? { vault: this.host.vaultName(), defaultFolder: CLIPPER_DEFAULT_FOLDER } : {}) });
      }
      if (!this.host.clipperOn()) return send(403, { error: 'The web clipper is off. Switch it on in Ironleaf Settings.' });
      if (req.method === 'POST' && url === '/pair') {
        const body = await readBody(req, BODY_SMALL_MAX);
        const parsed = JSON.parse(body) as { code?: unknown };
        const token = await this.pair(String(parsed.code ?? ''));
        if (!token) {
          const throttled = this.attempts.length >= 10;
          return send(throttled ? 429 : 403, { error: throttled ? 'Too many tries. Wait a minute, then try again.' : 'That code is not right. Check it in Ironleaf Settings.' });
        }
        return send(200, { token });
      }
      if (!this.paired(req.headers as Record<string, string | string[] | undefined>)) return send(403, { error: 'This browser is not paired. Pair it with the code in Ironleaf Settings.' });
      if (req.method === 'GET' && url === '/places') {
        await this.host.ready();
        const places = await this.host.places();
        return send(200, { folders: places.folders.slice(0, 500), projects: places.projects.slice(0, 500), defaultFolder: CLIPPER_DEFAULT_FOLDER });
      }
      if (req.method === 'POST' && url === '/clip') {
        const body = await readBody(req, BODY_CLIP_MAX);
        const done = await fileClip(this.host, JSON.parse(body));
        return send(200, done);
      }
      return send(404, { error: 'Nothing here.' });
    } catch (err) {
      if (err instanceof SyntaxError) return send(400, { error: 'The clip could not be read. Try again.' });
      if (err instanceof Error && /too large/i.test(err.message)) return send(413, { error: 'That clip is too large. Clip the selection instead.' });
      this.host.log(`Web clipper: ${err instanceof Error ? err.message : String(err)}`);
      const status = (err as { status?: unknown }).status === 400 || (err instanceof Error && /isn’t there any more|licence|activated/i.test(err.message)) ? 400 : 500;
      return send(status, { error: err instanceof Error ? err.message : 'The clip could not be saved.' });
    }
  }
}

async function readBody(req: http.IncomingMessage, max: number): Promise<string> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > max) throw new Error('Too large.');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}
