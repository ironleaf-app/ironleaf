// Share a page (8.8, 31 Oct 2026; the gap analysis: "Sharing/collaboration: read-only share link + realtime co-edit
// vs Notion/OneNote"): the Share menu on every page's top bar. A clean copy, never a live link: Save as PDF (the note
// as its branded document, set in the brand kit, printed in a window nobody sees), Copy as formatted text (headings,
// lists and tables kept on paste), Save as Markdown (the file as is, a zip with its attachments when it has any) and
// Email it (the mail program with the branded PDF attached, never sent by itself). Private notes refuse every way
// here; secrets and private notes are out of every copy (src/shared/share.ts). After a PDF from a meeting or project
// note, "Keep with this note" files it in the note's Files and links it in the note.

import type { AssetListing, NamedBrandKit } from '../../../shared/assets';
import { brandDocument } from '../../../shared/brand-document';
import { kitForNote, kitWords } from '../../../shared/brand-kits';
import { readProps } from '../../../shared/frontmatter';
import { isMeetingNote } from '../../../shared/meetings';
import { isProjectProps } from '../../../shared/project-file';
import { attachmentsOf, isShareablePath, mailtoFallback, shareBody, shareHtml, shareMarkdownFile } from '../../../shared/share';
import type { MenuItem } from '../components/Menu';
import { fileUrl, resolveAny } from '../lib/resolve';
import * as A from './actions';
import { areaPlaces, getAreas } from './areas';
import { docs } from './docs';
import { getPerson } from './person';
import { getState, showError, toast } from './store';
import { uncertainForShare } from './wordFixes';

const refusePrivate = (): void => {
  toast('Private notes stay private: they can’t be shared.');
};

async function shareSource(path: string): Promise<{ title: string; text: string } | null> {
  if (!isShareablePath(path)) {
    refusePrivate();
    return null;
  }
  await docs.settle();
  const text = docs.text(path) ?? (await window.nv.notes.read(path));
  return { title: A.titleOf(path), text };
}

const resolveFrom = (path: string) => ({ resolve: (t: string) => resolveAny(t, path) ?? t });

/** A shared copy's addressing with the owner's name, so a meeting's mic reads as them (18 Nov 2026, t301 round 2:
 *  the branded PDF and the share labels still said "You"). The minutes doors' own chain: the licence account's
 *  name, then the notes' person. */
const shareOpts = async (path: string) => ({ ...resolveFrom(path), me: getPerson() ?? undefined });

/** The kit a note prints in, and whether the vault holds choices to name (several kits, or an area or project with its own). */
export interface NoteKit {
  kit: NamedBrandKit | null;
  palette: Partial<Record<'primary' | 'onDark', string[]>>;
  /** Naming it in the saved words ("in the Redline Co kit"), or saying today's words when there is nothing to choose between. */
  multi: boolean;
  /** The vault's own level for the note (a Health folder's note marks Confidential): null when unknown. */
  level: string | null;
}

/** The note's own kit, through the one function (null when the window cannot be asked: exports still print, cleanly). */
export async function noteKit(path: string, text?: string): Promise<NoteKit> {
  const none: NoteKit = { kit: null, palette: {}, multi: false, level: null };
  let listing: AssetListing | null = null;
  try {
    listing = await window.nv.assets.list();
  } catch {
    return none;
  }
  if (!listing) return none;
  const multi = (listing.kits?.length ?? 0) > 1 || Object.keys(listing.brandAreas ?? {}).length > 0 || Object.keys(listing.brandProjects ?? {}).length > 0;
  const props = getState().byPath.get(path)?.props ?? readProps(text ?? '');
  const projects = getState().notes.filter((n) => isProjectProps(n.props)).map((n) => ({ path: n.path, name: n.label || n.title }));
  const kit = kitForNote({ brand: listing.brand, brands: listing.kits ?? [], brandDefault: listing.brandDefault, brandAreas: listing.brandAreas ?? {}, brandProjects: listing.brandProjects ?? {} }, { path, props }, { areas: getAreas()?.areas ?? [], projects, places: areaPlaces() });
  const palette: Partial<Record<'primary' | 'onDark', string[]>> = {};
  for (const role of ['primary', 'onDark'] as const) {
    const rel = kit?.logos?.[role];
    const entry = rel ? listing.assets.find((a) => a.path === rel) : undefined;
    if (entry?.palette?.length) palette[role] = entry.palette;
  }
  let level: string | null = null;
  try {
    level = (await window.nv.privacy?.levelOf?.(path))?.level ?? null;
  } catch {
    level = null;
  }
  return { kit, palette, multi, level };
}

/**
 * The note as its branded document with the kit it printed in (5 Nov 2026): one finished HTML page set in the
 * person's brand kit (or clean and unbranded without one), printed in a window nobody sees. Export to PDF, Save as
 * PDF and Email it all print this and name the kit in their saved words.
 */
export async function brandHtmlAndKit(path: string, title: string, text: string): Promise<{ html: string; kit: NamedBrandKit | null; multi: boolean }> {
  const { kit, palette, multi, level } = await noteKit(path, text);
  const opts = await shareOpts(path);
  return { html: brandDocument({ title, text, path, kit, level, url: (rel) => fileUrl(rel), resolve: opts.resolve, ...(opts.me ? { me: opts.me } : {}), logoPalette: palette }), kit, multi };
}

/**
 * The note as its branded document (5 Nov 2026): one finished HTML page set in the person's brand kit (or clean and
 * unbranded without one), printed in a window nobody sees. Export to PDF, Save as PDF and Email it all print this.
 */
export async function brandHtmlFor(path: string, title: string, text: string): Promise<string> {
  return (await brandHtmlAndKit(path, title, text)).html;
}

/** A meeting or project note (its properties, or its words when they haven't been read yet): its PDF may be kept with it. */
export function isKeepNote(path: string, text: string): boolean {
  const props = getState().byPath.get(path)?.props ?? readProps(text);
  return isMeetingNote(path, props) || isProjectProps(props);
}

const savedName = (file: string) => file.split(/[\\/]/).pop() ?? 'PDF';

/**
 * Keep with this note: the PDF just made placed in the note's Files with its record (a new export of the same note a
 * new version), and linked in the note, once. The note's own words are never changed by making a PDF: only this tap.
 */
export async function keepWithNote(notePath: string, pdfFile: string): Promise<void> {
  try {
    const r = await window.nv.vfiles.add(notePath, [pdfFile], 'version', 'added');
    const rel = r.placed[0];
    if (!rel) {
      if (r.problems[0]) showError(new Error(r.problems[0]));
      else toast('That PDF is already on its way in.');
      return;
    }
    const dir = notePath.includes('/') ? notePath.slice(0, notePath.lastIndexOf('/')) : '';
    const link = dir && rel.startsWith(`${dir}/`) ? rel.slice(dir.length + 1) : rel;
    const text = await docs.acquire(notePath);
    try {
      if (!text.includes(rel) && !text.includes(link)) {
        docs.update(notePath, `${text.replace(/\s*$/, '')}\n\n[[${link}]]\n`, 'keep-pdf');
        await docs.flush(notePath);
      }
    } finally {
      docs.release(notePath);
    }
    toast(`Kept with ${A.displayName(notePath)}.`, { label: 'Show', run: () => void import('./peek').then((P) => P.peek({ type: 'file', path: rel }, { title: rel.split('/').pop(), type: 'file' })) });
  } catch (err) {
    showError(err);
  }
}

/** Before a meeting's PDF or email: unsure words nudge to the check list, never block (5 Nov 2026, minutes). */
async function nudgeWords(path: string, text: string): Promise<void> {
  const unsure = await uncertainForShare(path, text).catch(() => 0);
  if (unsure > 0) toast(`${unsure} ${unsure === 1 ? 'word' : 'words'} may be misspelt.`, { label: 'Check the words', run: () => window.dispatchEvent(new CustomEvent('nv-minutes-check', { detail: path })) });
}

/** Save as PDF: the note as its branded document, set in the person's brand kit. */
export async function saveSharePdf(path: string): Promise<void> {
  const src = await shareSource(path).catch((err) => (showError(err), null));
  if (!src) return;
  const body = shareBody(src.text, await shareOpts(path));
  if (!body.trim()) {
    toast('There is nothing to share.');
    return;
  }
  void nudgeWords(path, src.text).catch(() => undefined);
  try {
    const printed = await brandHtmlAndKit(path, src.title, src.text);
    const file = await window.nv.exports.brandPdf(src.title, printed.html);
    if (!file) return;
    const words = printed.multi ? `Saved ${savedName(file)} ${kitWords(printed.kit)}.` : `Saved ${savedName(file)}.`;
    if (isKeepNote(path, src.text)) toast(words, { label: 'Keep with this note', run: () => void keepWithNote(path, file) });
    else toast(words, { label: 'Show', run: () => void window.nv.exports.reveal(file) });
  } catch (err) {
    showError(err);
  }
}

/** Copy as formatted text: headings, lists and tables kept on paste into email or Word. */
export async function copyShareFormatted(path: string): Promise<void> {
  const src = await shareSource(path).catch((err) => (showError(err), null));
  if (!src) return;
  try {
    const { kit, multi } = await noteKit(path, src.text);
    const opts = await shareOpts(path);
    const html = shareHtml(src.title, src.text, { ...opts, url: (rel) => fileUrl(rel), ...(kit ? { brand: kit } : {}) });
    const plain = shareBody(src.text, opts);
    if (!plain.trim()) {
      toast('There is nothing to share.');
      return;
    }
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([plain], { type: 'text/plain' }) })]);
    else await navigator.clipboard.writeText(plain);
    toast(multi ? `Copied as formatted text ${kitWords(kit)}.` : 'Copied as formatted text.');
  } catch (err) {
    showError(err);
  }
}

/** Save as Markdown: the file as is, a zip with its attachments when it has any. */
export async function saveShareMarkdown(path: string): Promise<void> {
  const src = await shareSource(path).catch((err) => (showError(err), null));
  if (!src) return;
  try {
    const file = await window.nv.exports.shareMd(src.title, shareMarkdownFile(src.text, resolveFrom(path)), attachmentsOf(src.text, resolveFrom(path)));
    if (file) toast(`Saved ${file.split(/[\\/]/).pop()}.`, { label: 'Show', run: () => void window.nv.exports.reveal(file) });
  } catch (err) {
    showError(err);
  }
}

/** The draft's first paragraph as the page reads (9.2 uplift F144): from the rendered blocks, whose parser
 *  already left front matter and properties out, never from raw lines through strip-markdown regexes. */
function firstRenderedPara(html: string): string {
  const el = document.createElement('div');
  el.innerHTML = html;
  for (const b of el.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, blockquote, td, pre')) {
    const t = (b.textContent ?? '').trim();
    if (t) return t.split('\n').map((l) => l.trim()).filter(Boolean)[0] ?? '';
  }
  return '';
}

/** The draft's words: the page's first paragraph (the subject is its title). */
function emailWords(title: string, html: string): string {
  const para = firstRenderedPara(html);
  return para ? `Here is “${title}”.\n\n${para.slice(0, 500)}` : `Here is “${title}”.`;
}

/** Email it: the mail program with the branded PDF attached. Opening the draft is all it does; sending stays the person's. */
export async function emailShare(path: string): Promise<void> {
  const src = await shareSource(path).catch((err) => (showError(err), null));
  if (!src) return;
  const body = shareBody(src.text, await shareOpts(path));
  if (!body.trim()) {
    toast('There is nothing to share.');
    return;
  }
  void nudgeWords(path, src.text).catch(() => undefined);
  try {
    const { renderMarkdown } = await import('../lib/markdownRender');
    const words = emailWords(src.title, renderMarkdown(body, { from: path }));
    const printed = await brandHtmlAndKit(path, src.title, src.text);
    const sent = await window.nv.exports.shareEmail(src.title, src.title, words, printed.html);
    const draft = printed.multi ? `Your mail program has the draft ${kitWords(printed.kit)}.` : 'Your mail program has the draft.';
    if (sent.opened) {
      if (isKeepNote(path, src.text)) toast(draft, { label: 'Keep with this note', run: () => void keepWithNote(path, sent.pdf) });
      else toast(draft);
    } else {
      // The draft file wouldn't open: the mail program with the words, the PDF named to attach.
      window.open(mailtoFallback({ subject: src.title, body: `${words}\n\n(Attach the PDF: ${sent.pdf})` }));
      toast(`Saved ${savedName(sent.pdf)}. Attach it to the email.`, { label: 'Show', run: () => void window.nv.exports.reveal(sent.pdf) });
    }
  } catch (err) {
    showError(err);
  }
}

/** The Share menu's four ways, in plain words. Nothing here for a private note (the button hides itself). */
export function shareMenuItems(path: string): MenuItem[] {
  return [
    { label: 'Save as PDF', icon: 'pdf', run: () => void saveSharePdf(path) },
    { label: 'Copy as formatted text', icon: 'copy', run: () => void copyShareFormatted(path) },
    { label: 'Save as Markdown', icon: 'notes', run: () => void saveShareMarkdown(path) },
    { label: 'Email it', icon: 'mail', run: () => void emailShare(path) },
  ];
}
