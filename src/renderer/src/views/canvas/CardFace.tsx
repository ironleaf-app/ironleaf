// What an ordinary canvas card shows, fitted to its size: a text card's words (wrapping to its width, scrolling inside
// when they run past it); a note card as a preview (its title and first lines) when small and the whole note when
// large; pictures, PDFs, video and sound fitted to the frame; a web link as a designed card. At far zoom a card shows
// only its title on its colour (cardTitle), so a big board still reads.

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { CanvasNode } from '../../../../shared/project-canvas';
import { fileIcon, Icon } from '../../components/Icon';
import { hydrate } from '../../lib/hydrate';
import { renderMarkdown, wikilinkFromClick } from '../../lib/markdownRender';
import { fileUrl, isAudio, isImage, isPdf, isVideo } from '../../lib/resolve';
import * as A from '../../state/actions';
import { docs } from '../../state/docs';
import { useApp } from '../../state/store';
import { usePdfFirstPage } from '../../lib/pdfThumb';
import { firstLines, headingKey, isDocText, parseDoc } from '../../../../shared/doc-file';
import { isDrawingPath } from '../../../../shared/drawing';
import { DrawingPreview } from '../DrawingView';

const isNote = (p: string) => /\.md$/i.test(p);

/** A card's title (for far zoom, search and the minimap). */
export function cardTitle(n: CanvasNode): string {
  if (n.type === 'group') return n.label || 'Group';
  if (n.type === 'file' && n.file && n.subpath && isNote(n.file)) return n.subpath.replace(/^#/, '');
  if (n.type === 'file' && n.file) return isNote(n.file) ? A.titleOf(n.file) : A.nameOf(n.file);
  if (n.type === 'link') {
    try {
      return new URL(n.url ?? '').host.replace(/^www\./, '');
    } catch {
      return n.url ?? 'Link';
    }
  }
  const first = (n.text ?? '').split('\n').find((l) => l.trim()) ?? '';
  return first.replace(/^#+\s*|^[-*+]\s+(\[[ xX]\]\s*)?|[*_`~[\]]/g, '').trim();
}

/** The words a card holds (for search within the canvas). */
export function cardWords(n: CanvasNode): string {
  return [cardTitle(n), n.text ?? '', n.file ?? '', n.url ?? '', n.label ?? ''].join('\n').toLowerCase();
}

function useNoteText(path: string): string | null {
  const revision = useApp((s) => s.revision);
  const [text, setText] = useState<string | null>(docs.text(path) ?? null);
  useEffect(() => {
    let alive = true;
    const now = docs.text(path);
    if (now !== undefined) setText(now);
    else
      window.nv.notes.read(path).then(
        (t) => alive && setText(t),
        () => alive && setText(''),
      );
    const off = docs.subscribe(path, (t) => alive && setText(t));
    return () => {
      alive = false;
      off();
    };
  }, [path, revision]);
  return text;
}

function Markdown({ text, from, onOpen }: { text: string; from: string; onOpen(target: string, newTab: boolean): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const html = useMemo(() => renderMarkdown(text, { from }), [text, from]);
  useEffect(() => {
    if (ref.current && html) void hydrate(ref.current, 1);
  }, [html]);
  return (
    <div
      ref={ref}
      className="markdown canvas-markdown"
      onClick={(e) => {
        const target = wikilinkFromClick(e);
        if (target !== null) {
          e.preventDefault();
          e.stopPropagation();
          onOpen(target, e.ctrlKey || e.metaKey);
        }
      }}
      // Rendered with raw HTML switched off (markdownRender.ts).
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

const stripFront = (t: string) => t.replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/, '');

function NoteFace({ path, small, onOpen }: { path: string; small: boolean; onOpen(target: string, newTab: boolean): void }) {
  const text = useNoteText(path);
  if (text === null) return <div className="cv-loading" />;
  const body = stripFront(text);
  if (!body.trim()) return <div className="cv-placeholder">An empty note. Double-click to write in it.</div>;
  if (small) {
    // A preview: the first lines as plain words.
    const lines = body
      .split('\n')
      .filter((l) => l.trim() && !/^#\s/.test(l))
      .slice(0, 8)
      .map((l) => l.replace(/^#+\s*|^[-*+]\s+(\[[ xX]\]\s*)?|^>\s?|[*_`~]|!?\[\[([^\]|]+)(\|([^\]]+))?\]\]/g, (_m, _a, target, _b, alias) => (target ? alias || target : '')).trim());
    return (
      <div className="cv-note-preview">
        {lines.map((l, i) => (
          <p key={i}>{l}</p>
        ))}
      </div>
    );
  }
  return <Markdown text={body} from={path} onOpen={onOpen} />;
}

function LinkFace({ url }: { url: string }) {
  let host = url;
  let rest = '';
  try {
    const u = new URL(url);
    host = u.host.replace(/^www\./, '');
    rest = `${u.pathname === '/' ? '' : u.pathname}${u.search}`;
  } catch {
    // As written.
  }
  return (
    <div className="cv-link">
      <span className="cv-link-tile" aria-hidden>
        {host.charAt(0).toUpperCase()}
      </span>
      <span className="cv-link-words">
        <span className="cv-link-host">{host}</span>
        {rest && <span className="cv-link-path">{decodeURIComponent(rest).slice(0, 140)}</span>}
      </span>
      <button className="cv-open icon" title="Open the link" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); window.open(url, '_blank'); }}>
        <Icon name="external" size={14} />
      </button>
    </div>
  );
}

/** A PDF on a canvas: its first page as a picture (light to draw however many there are; drawn once, kept); open it to
 * read the rest. A PDF that can't be drawn shows its name. */
function PdfFace({ path, onOpen }: { path: string; onOpen(target: string, newTab: boolean): void }) {
  const meta = useApp((s) => s.files.find((f) => f.rel === path));
  const { ref, url } = usePdfFirstPage({ rel: path }, meta ? `${meta.mtime}:${meta.size}` : 0);
  return (
    <div className="canvas-pdf-face" ref={ref as React.RefObject<HTMLDivElement>} onDoubleClick={(e) => (e.stopPropagation(), onOpen(path, e.ctrlKey || e.metaKey))} title="Double-click to open it">
      {url ? (
        <img className="canvas-pdf-page" src={url} alt={A.nameOf(path)} draggable={false} />
      ) : (
        <div className="canvas-file-other">
          <Icon name="pdf" size={26} />
          <span>{A.nameOf(path)}</span>
        </div>
      )}
    </div>
  );
}

/** A note's section on a canvas (a file card with "#Heading"): the section's first lines; the heading is the card's
 * title. Opening it opens the note at that heading. */
function SectionFace({ path, heading }: { path: string; heading: string }) {
  const text = useNoteText(path);
  if (text === null) return <div className="cv-loading" />;
  const doc = parseDoc(text, path);
  const key = headingKey(heading);
  const section = doc.sections.find((s) => headingKey(s.heading) === key);
  if (!section) {
    // A heading deeper down (### …): its lines until the next heading.
    const lines = text.split(/\r?\n/);
    const at = lines.findIndex((l) => /^#{1,6}\s/.test(l) && headingKey(l.replace(/^#+\s*/, '')) === key);
    if (at < 0) return <div className="cv-section-empty">This section isn’t in {doc.name} any more. Update the canvas from the doc to tidy it.</div>;
    const end = lines.findIndex((l, i) => i > at && /^#{1,6}\s/.test(l));
    const words = firstLines(lines.slice(at + 1, end < 0 ? undefined : end).join('\n'), 6);
    return <div className="cv-section-face">{words.length ? words.map((w, i) => <p key={i}>{w}</p>) : <span className="cv-section-empty">Nothing written here yet.</span>}</div>;
  }
  const words = firstLines(section.body, 6);
  const subs = (section.body.match(/^###\s+.+$/gm) ?? []).length;
  return (
    <div className="cv-section-face">
      {words.length ? words.map((w, i) => <p key={i}>{w}</p>) : <span className="cv-section-empty">Nothing written here yet.</span>}
      {subs > 0 && <span className="cv-section-sub">{subs === 1 ? '1 part inside' : `${subs} parts inside`}</span>}
    </div>
  );
}

/** A doc on a canvas (src/shared/doc-file.ts): what it is, its summary and its sections, at a glance. */
function DocFace({ path }: { path: string }) {
  const text = useNoteText(path);
  if (text === null) return <div className="cv-loading" />;
  const doc = parseDoc(text, path);
  return (
    <div className="cv-doc-face">
      <span className="doc-kind cv-doc-kind">
        <Icon name="doc" size={12} />
        Doc
      </span>
      <div className="cv-doc-name">{doc.name}</div>
      {doc.about && <div className="cv-doc-about">{doc.about}</div>}
      {doc.summary && <div className="cv-doc-summary">{firstLines(doc.summary, 4).join(' ')}</div>}
      {doc.sections.length > 0 && (
        <div className="cv-doc-sections">
          {doc.sections.slice(0, 8).map((s) => (
            <span key={s.line}>{s.heading}</span>
          ))}
          {doc.sections.length > 8 && <span>+{doc.sections.length - 8}</span>}
        </div>
      )}
    </div>
  );
}

/** Whether a note on a canvas is a doc (its words say so, or it sits in the Docs folder). */
function useIsDoc(path: string): boolean {
  const props = useApp((s) => s.byPath.get(path)?.props);
  const text = docs.text(path);
  return props?.type === 'doc' || (text !== undefined && isDocText(text)) || (/^Docs\/[^/]+\.md$/i.test(path) && !props?.type);
}

function NoteCard({ path, node, onOpen }: { path: string; node: CanvasNode; onOpen(target: string, newTab: boolean): void }) {
  const doc = useIsDoc(path);
  if (node.subpath) return <SectionFace path={path} heading={node.subpath.replace(/^#/, '')} />;
  if (doc) return <DocFace path={path} />;
  return <NoteFace path={path} small={node.width < 300 || node.height < 220} onOpen={onOpen} />;
}

/** An ordinary card's content (not one drawn from a project). */
export const CardFace = memo(function CardFace({ node, board, onOpen }: { node: CanvasNode; board: string; onOpen(target: string, newTab: boolean): void }) {
  const file = node.type === 'file' ? node.file ?? '' : '';
  if (node.type === 'text') {
    if (!(node.text ?? '').trim()) return <div className="cv-placeholder">Type, or drop a file</div>;
    return <Markdown text={node.text ?? ''} from={board} onOpen={onOpen} />;
  }
  if (node.type === 'link') return <LinkFace url={node.url ?? ''} />;
  if (node.type === 'file') {
    if (isNote(file)) return <NoteCard path={file} node={node} onOpen={onOpen} />;
    if (isDrawingPath(file)) return <DrawingPreview path={file} />;
    if (isImage(file)) return <img className="canvas-image" src={fileUrl(file)} alt={A.nameOf(file)} draggable={false} loading="lazy" />;
    if (isPdf(file)) return <PdfFace path={file} onOpen={onOpen} />;
    if (isVideo(file)) return <video className="canvas-video" src={fileUrl(file)} controls />;
    if (isAudio(file)) return <audio className="canvas-audio" src={fileUrl(file)} controls />;
    return (
      <div className="canvas-file-other">
        <Icon name={fileIcon(file)} size={26} />
        <span>{A.nameOf(file)}</span>
      </div>
    );
  }
  return null;
});
