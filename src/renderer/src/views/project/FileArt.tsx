// How a file looks when there's no picture of it: a small kind label in lists, and in the grid a designed sheet of paper
// for its kind (lines for a document, cells for a spreadsheet, a slide, a picture's frame), its type on a coloured band.
// Pictures show themselves; PDFs their first page drawn here (lib/pdfThumb.ts); slides their first page when Windows
// makes one (project:thumb).

import { useEffect, useRef, useState } from 'react';
import type { ProjectFile } from '../../../../shared/types';
import { fileKind } from '../../lib/projectLook';
import { folderFileUrl, viewerFor } from './fileModel';
import { usePdfFirstPage } from '../../lib/pdfThumb';
import { isRemoteHandle } from '../../../../shared/project-folder';
import { remoteFileUrl } from '../../lib/fileUrl';

export function KindTile({ ext, size = 'small' }: { ext: string; size?: 'small' | 'large' }) {
  const k = fileKind(ext);
  return <span className={`pj-kind kind-${k.kind} pf-kind-${size}`}>{k.label}</span>;
}

/** The designed tile for a kind of file. */
export function TypeArt({ ext }: { ext: string }) {
  const k = fileKind(ext);
  const label = (ext || 'file').slice(0, 5).toUpperCase();
  return (
    <span className={`pf-art kind-${k.kind}`} aria-hidden="true">
      <span className="pf-paper">
        <span className={`pf-marks pf-marks-${k.kind}`}>
          {k.kind === 'sheet' ? Array.from({ length: 12 }, (_, i) => <i key={i} />) : k.kind === 'slides' ? <i /> : k.kind === 'image' ? <i /> : Array.from({ length: 6 }, (_, i) => <i key={i} />)}
        </span>
        <span className="pf-band">{label}</span>
      </span>
    </span>
  );
}

const thumbs = new Map<string, string | null>();

/** A picture of the file for the grid: the picture itself, a first page made by Windows, or the designed tile. */
export function Thumb({ project, folder, file }: { project: string; folder: string; file: ProjectFile }) {
  // A remote computer's pictures come through the former host app once on screen; its other files show their
  // kind's sheet.
  if (/^pdf$/i.test(file.ext)) return <PdfThumb project={project} file={file} />;
  if (isRemoteHandle(folder)) return viewerFor(file.ext) === 'image' && file.size <= 8 * 1048576 ? <RemoteThumb project={project} file={file} /> : <span className="pf-thumb"><TypeArt ext={file.ext} /></span>;
  return <WindowsThumb project={project} folder={folder} file={file} />;
}

/** A PDF: its first page, drawn here with PDF.js (so it never depends on what Windows can make); the designed tile until
 * it is ready, or for good when the PDF can't be drawn. */
function PdfThumb({ project, file }: { project: string; file: ProjectFile }) {
  const { ref, url } = usePdfFirstPage({ project, file: file.rel, version: `${file.modified}:${file.size}` }, `${file.modified}:${file.size}`);
  return (
    <span className="pf-thumb" ref={ref as React.RefObject<HTMLSpanElement>}>
      {url ? <img className="pf-page-thumb" src={url} alt="" /> : <TypeArt ext={file.ext} />}
    </span>
  );
}

/** A picture on a remote computer: fetched through the former host app once its tile is on screen; its kind's sheet until
then. */
function RemoteThumb({ project, file }: { project: string; file: ProjectFile }) {
  const [url, setUrl] = useState<string | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    let live = true;
    const seen = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      seen.disconnect();
      remoteFileUrl(project, file).then(
        (u) => live && setUrl(u),
        () => undefined,
      );
    });
    seen.observe(ref.current);
    return () => {
      live = false;
      seen.disconnect();
    };
  }, [project, file.rel, file.modified]);
  return (
    <span className="pf-thumb" ref={ref}>
      {url ? <img src={url} alt="" decoding="async" /> : <TypeArt ext={file.ext} />}
    </span>
  );
}

/** Slides (and pictures): the picture itself, or a first page Windows makes. */
function WindowsThumb({ project, folder, file }: { project: string; folder: string; file: ProjectFile }) {
  const view = viewerFor(file.ext);
  const key = `${project}|${file.rel}|${file.modified}`;
  const asks = /^(pptx?|odp)$/i.test(file.ext);
  const [thumb, setThumb] = useState<string | null | undefined>(asks ? thumbs.get(key) : null);
  const [broken, setBroken] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!asks || thumb !== undefined || !ref.current) return;
    // Asked for only once the tile is on screen.
    const seen = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      seen.disconnect();
      window.nv.projects.thumb(project, file.rel).then(
        (url) => {
          thumbs.set(key, url);
          setThumb(url);
        },
        () => setThumb(null),
      );
    });
    seen.observe(ref.current);
    return () => seen.disconnect();
  }, [key]);
  return (
    <span className="pf-thumb" ref={ref}>
      {view === 'image' && !broken ? (
        <img src={folderFileUrl(folder, file.rel)} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} />
      ) : thumb ? (
        <img className="pf-page-thumb" src={thumb} alt="" />
      ) : (
        <TypeArt ext={file.ext} />
      )}
    </span>
  );
}

/** What a kind of file is, in words. */
export function kindWords(ext: string): string {
  const e = ext.toLowerCase();
  if (['docx', 'doc', 'docm'].includes(e)) return 'Word document';
  if (['xlsx', 'xlsm', 'xls', 'xlsb'].includes(e)) return 'Excel workbook';
  if (['pptx', 'ppt', 'pptm'].includes(e)) return 'PowerPoint slides';
  if (['odt', 'rtf'].includes(e)) return 'Document';
  if (['ods'].includes(e)) return 'Spreadsheet';
  if (['odp'].includes(e)) return 'Slides';
  if (['msg', 'eml'].includes(e)) return 'Email';
  if (e === 'pdf') return 'PDF';
  if (e === 'csv') return 'CSV table';
  if (['md', 'markdown'].includes(e)) return 'Markdown note';
  if (['zip', '7z', 'rar'].includes(e)) return 'Compressed folder';
  if (viewerFor(e) === 'image') return 'Picture';
  if (viewerFor(e) === 'video') return 'Video';
  if (viewerFor(e) === 'audio') return 'Recording';
  return e ? `${e.toUpperCase()} file` : 'File';
}
